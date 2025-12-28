import { handler } from './permanent-delete';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as auth from '../shared/auth';
import * as db from '../shared/db';
import * as audit from '../shared/audit';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

jest.mock('../shared/auth');
jest.mock('../shared/db');
jest.mock('../shared/audit');
jest.mock('@aws-sdk/client-sqs');

const mockValidateToken = auth.validateToken as jest.MockedFunction<
  typeof auth.validateToken
>;
const mockExtractToken = auth.extractToken as jest.MockedFunction<
  typeof auth.extractToken
>;
const mockHasAdminRole = auth.hasAdminRole as jest.MockedFunction<
  typeof auth.hasAdminRole
>;
const mockQueryOne = db.queryOne as jest.MockedFunction<typeof db.queryOne>;
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockCreateAuditLog = audit.createAuditLog as jest.MockedFunction<
  typeof audit.createAuditLog
>;
const mockGetClientIp = audit.getClientIp as jest.MockedFunction<
  typeof audit.getClientIp
>;

const mockSQSSend = jest.fn();
(SQSClient as jest.MockedClass<typeof SQSClient>).prototype.send = mockSQSSend;

describe('Permanent Delete API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractToken.mockReturnValue('mock-token');
    mockValidateToken.mockResolvedValue({
      userId: 'admin-1',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      scopes: ['admin'],
    });
    mockHasAdminRole.mockReturnValue(true);
    mockGetClientIp.mockReturnValue('192.168.1.1');
    mockCreateAuditLog.mockResolvedValue();
    mockSQSSend.mockResolvedValue({});
  });

  const createMockEvent = (
    documentId: string,
    confirm: boolean
  ): APIGatewayProxyEvent =>
    ({
      pathParameters: { id: documentId },
      headers: { Authorization: 'Bearer mock-token' },
      body: JSON.stringify({ confirm }),
      requestContext: { requestId: 'req-123' } as any,
    } as any);

  describe('Permanent deletion', () => {
    it('should initiate permanent deletion with admin role and confirmation', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'READY',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);
      mockQuery.mockResolvedValue([]);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('deleting');
      expect(body.documentId).toBe('doc-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE documents'),
        expect.arrayContaining(['DELETING', expect.any(Date), 'doc-1'])
      );

      expect(mockSQSSend).toHaveBeenCalledWith(
        expect.any(SendMessageCommand)
      );

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'admin-1',
        action: 'PERMANENT_DELETE',
        documentId: 'doc-1',
        ipAddress: '192.168.1.1',
        metadata: {
          documentName: 'test.pdf',
          previousStatus: 'READY',
          bypassedRetention: true,
        },
      });
    });

    it('should reject request without admin role', async () => {
      mockHasAdminRole.mockReturnValue(false);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('Admin role required');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject request without explicit confirmation', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'READY',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1', false);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('confirmation required');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject deletion of document with legal hold', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'READY',
        legalHold: true,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('legal hold');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject deletion of document from different tenant', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-2',
        name: 'test.pdf',
        status: 'READY',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject deletion of document already being deleted', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'DELETING',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already being deleted');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent document', async () => {
      mockQueryOne.mockResolvedValue(null);

      const event = createMockEvent('doc-999', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should allow permanent deletion of soft-deleted document', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'DELETED',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);
      mockQuery.mockResolvedValue([]);

      const event = createMockEvent('doc-1', true);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('deleting');
    });
  });
});

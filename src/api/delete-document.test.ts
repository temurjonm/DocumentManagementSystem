import { handler } from './delete-document';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as auth from '../shared/auth';
import * as db from '../shared/db';
import * as audit from '../shared/audit';

jest.mock('../shared/auth');
jest.mock('../shared/db');
jest.mock('../shared/audit');

const mockValidateToken = auth.validateToken as jest.MockedFunction<
  typeof auth.validateToken
>;
const mockExtractToken = auth.extractToken as jest.MockedFunction<
  typeof auth.extractToken
>;
const mockQueryOne = db.queryOne as jest.MockedFunction<typeof db.queryOne>;
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockCreateAuditLog = audit.createAuditLog as jest.MockedFunction<
  typeof audit.createAuditLog
>;
const mockGetClientIp = audit.getClientIp as jest.MockedFunction<
  typeof audit.getClientIp
>;

describe('Delete Document API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractToken.mockReturnValue('mock-token');
    mockValidateToken.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'user@example.com',
      scopes: [],
    });
    mockGetClientIp.mockReturnValue('192.168.1.1');
    mockCreateAuditLog.mockResolvedValue();
  });

  const createMockEvent = (documentId: string): APIGatewayProxyEvent => ({
    pathParameters: { id: documentId },
    headers: { Authorization: 'Bearer mock-token' },
    requestContext: { requestId: 'req-123' } as any,
  } as any);

  describe('Soft delete', () => {
    it('should soft delete a document successfully', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        ownerId: 'user-1',
        status: 'READY',
        legalHold: false,
        deletedAt: null,
      };

      mockQueryOne.mockResolvedValue(mockDocument);
      mockQuery.mockResolvedValue([]);

      const event = createMockEvent('doc-1');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('soft_deleted');
      expect(body.documentId).toBe('doc-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE documents'),
        expect.arrayContaining(['DELETED', expect.any(Date), 'doc-1'])
      );

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'DELETE',
        documentId: 'doc-1',
        ipAddress: '192.168.1.1',
        metadata: {
          documentName: 'test.pdf',
          previousStatus: 'READY',
        },
      });
    });

    it('should reject deletion of document from different tenant', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-2',
        name: 'test.pdf',
        ownerId: 'user-2',
        status: 'READY',
        legalHold: false,
        deletedAt: null,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1');
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject deletion of document with legal hold', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        ownerId: 'user-1',
        status: 'READY',
        legalHold: true,
        deletedAt: null,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1');
      const result = await handler(event);

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('legal hold');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject deletion of already deleted document', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        ownerId: 'user-1',
        status: 'DELETED',
        legalHold: false,
        deletedAt: new Date(),
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1');
      const result = await handler(event);

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already deleted');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent document', async () => {
      mockQueryOne.mockResolvedValue(null);

      const event = createMockEvent('doc-999');
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});

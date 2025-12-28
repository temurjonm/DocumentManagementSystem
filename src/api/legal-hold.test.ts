import { setLegalHold } from './legal-hold';
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

describe('Legal Hold API', () => {
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

  const createMockEvent = (
    documentId: string,
    legalHold: boolean
  ): APIGatewayProxyEvent =>
    ({
      pathParameters: { id: documentId },
      headers: { Authorization: 'Bearer mock-token' },
      body: JSON.stringify({ legalHold }),
      requestContext: { requestId: 'req-123' } as any,
    } as any);

  describe('Set legal hold', () => {
    it('should set legal hold to true', async () => {
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
      const result = await setLegalHold(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.legalHold).toBe(true);
      expect(body.documentId).toBe('doc-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE documents'),
        expect.arrayContaining([true, 'doc-1'])
      );

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'LEGAL_HOLD_SET',
        documentId: 'doc-1',
        ipAddress: '192.168.1.1',
        metadata: {
          documentName: 'test.pdf',
          previousLegalHold: false,
          newLegalHold: true,
        },
      });
    });

    it('should remove legal hold', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'test.pdf',
        status: 'READY',
        legalHold: true,
      };

      mockQueryOne.mockResolvedValue(mockDocument);
      mockQuery.mockResolvedValue([]);

      const event = createMockEvent('doc-1', false);
      const result = await setLegalHold(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.legalHold).toBe(false);

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LEGAL_HOLD_REMOVED',
        })
      );
    });

    it('should reject request with invalid legalHold value', async () => {
      const event = {
        pathParameters: { id: 'doc-1' },
        headers: { Authorization: 'Bearer mock-token' },
        body: JSON.stringify({ legalHold: 'invalid' }),
        requestContext: { requestId: 'req-123' } as any,
      } as any;

      const result = await setLegalHold(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('boolean');
    });

    it('should reject request for document from different tenant', async () => {
      const mockDocument = {
        id: 'doc-1',
        tenantId: 'tenant-2',
        name: 'test.pdf',
        status: 'READY',
        legalHold: false,
      };

      mockQueryOne.mockResolvedValue(mockDocument);

      const event = createMockEvent('doc-1', true);
      const result = await setLegalHold(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent document', async () => {
      mockQueryOne.mockResolvedValue(null);

      const event = createMockEvent('doc-999', true);
      const result = await setLegalHold(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});

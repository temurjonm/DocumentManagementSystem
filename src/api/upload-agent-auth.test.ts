import { handler as initUploadHandler } from './init-upload';
import { hasUploadScope } from '../shared/auth';
import * as db from '../shared/db';
import * as s3 from '../shared/s3';
import { AuthContext } from '../types';

jest.mock('../shared/db');
jest.mock('../shared/s3');
jest.mock('../shared/audit');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockQueryOne = db.queryOne as jest.MockedFunction<typeof db.queryOne>;
const mockGenerateUploadUrl = s3.generateUploadUrl as jest.MockedFunction<
  typeof s3.generateUploadUrl
>;
const mockGetKmsKeyForTenant = s3.getKmsKeyForTenant as jest.MockedFunction<
  typeof s3.getKmsKeyForTenant
>;

describe('Upload Agent Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
    mockQueryOne.mockResolvedValue({
      id: 'tenant-1',
      name: 'Test Tenant',
      kms_key_arn: null,
    } as any);
    mockGenerateUploadUrl.mockResolvedValue({
      url: 'https://s3.amazonaws.com/presigned-url',
      expiresAt: new Date(Date.now() + 900000),
    });
    mockGetKmsKeyForTenant.mockReturnValue('default-kms-key');
  });

  describe('Client Credentials Flow', () => {
    it('should accept token with client credentials scope', async () => {
      const mockToken = 'mock-client-credentials-token';
      const mockAuthContext: AuthContext = {
        userId: 'client-app-1',
        tenantId: 'tenant-1',
        email: 'app@example.com',
        scopes: ['dms/upload'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          requestId: 'req-123',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.documentId).toBeDefined();
      expect(body.uploadUrl).toBeDefined();
      expect(body.expiresAt).toBeDefined();
    });

    it('should reject token without upload scope', async () => {
      const mockToken = 'mock-invalid-token';
      const mockAuthContext: AuthContext = {
        userId: 'client-app-1',
        tenantId: 'tenant-1',
        email: 'app@example.com',
        scopes: ['dms/read'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          requestId: 'req-123',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('upload permission');
    });

    it('should issue JWT token with limited scopes for client credentials', () => {
      const agentContext: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      expect(hasUploadScope(agentContext)).toBe(true);
      expect(agentContext.scopes).toHaveLength(1);
      expect(agentContext.scopes).toContain('dms/upload');
      expect(agentContext.scopes).not.toContain('dms/read');
      expect(agentContext.scopes).not.toContain('dms/delete');
      expect(agentContext.scopes).not.toContain('admin');
    });
  });

  describe('Device Code Flow', () => {
    it('should accept token from device code flow with upload scope', async () => {
      const mockToken = 'mock-device-token';
      const mockAuthContext: AuthContext = {
        userId: 'device-user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/upload', 'openid'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'device-upload.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        }),
        requestContext: {
          requestId: 'req-456',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.documentId).toBeDefined();
      expect(body.uploadUrl).toBeDefined();
    });

    it('should allow device code flow tokens with openid scope', () => {
      const deviceContext: AuthContext = {
        userId: 'device-user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/upload', 'openid'],
      };

      expect(hasUploadScope(deviceContext)).toBe(true);
      expect(deviceContext.scopes).toContain('openid');
    });
  });

  describe('Token Scope Validation', () => {
    it('should validate upload scope before processing request', async () => {
      const mockToken = 'mock-token';
      const mockAuthContext: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/read', 'dms/delete'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          requestId: 'req-789',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should accept tokens with upload scope regardless of prefix', () => {
      const contextWithPrefix: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/upload'],
      };

      const contextWithoutPrefix: AuthContext = {
        userId: 'user-2',
        tenantId: 'tenant-1',
        email: 'user2@example.com',
        scopes: ['upload'],
      };

      expect(hasUploadScope(contextWithPrefix)).toBe(true);
      expect(hasUploadScope(contextWithoutPrefix)).toBe(true);
    });
  });

  describe('No Permanent S3 Credentials', () => {
    it('should return pre-signed URL instead of permanent credentials', async () => {
      const mockToken = 'mock-token';
      const mockAuthContext: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          requestId: 'req-999',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);

      expect(body.uploadUrl).toBeDefined();
      expect(body.expiresAt).toBeDefined();
      expect(body.accessKeyId).toBeUndefined();
      expect(body.secretAccessKey).toBeUndefined();
      expect(body.sessionToken).toBeUndefined();
      expect(body.credentials).toBeUndefined();
    });

    it('should provide time-limited pre-signed URL', async () => {
      const mockToken = 'mock-token';
      const mockAuthContext: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      const expiresAt = new Date(Date.now() + 900000);
      mockGenerateUploadUrl.mockResolvedValue({
        url: 'https://s3.amazonaws.com/presigned-url',
        expiresAt,
      });

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          requestId: 'req-888',
        },
      } as any;

      const result = await initUploadHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);

      expect(body.uploadUrl).toContain('presigned-url');
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(
        Date.now() + 900000
      );
    });
  });

  describe('Same Flow as Web Users', () => {
    it('should follow same upload flow for agents and web users', async () => {
      const agentToken = 'agent-token';
      const webToken = 'web-token';

      const agentContext: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      const webContext: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/upload', 'dms/read', 'dms/delete'],
      };

      const validateTokenSpy = jest.spyOn(require('../shared/auth'), 'validateToken');
      const extractTokenSpy = jest.spyOn(require('../shared/auth'), 'extractToken');

      const requestBody = {
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      };

      extractTokenSpy.mockReturnValueOnce(agentToken);
      validateTokenSpy.mockResolvedValueOnce(agentContext);

      const agentEvent = {
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify(requestBody),
        requestContext: { requestId: 'req-agent' },
      } as any;

      const agentResult = await initUploadHandler(agentEvent);

      extractTokenSpy.mockReturnValueOnce(webToken);
      validateTokenSpy.mockResolvedValueOnce(webContext);

      const webEvent = {
        headers: { Authorization: `Bearer ${webToken}` },
        body: JSON.stringify(requestBody),
        requestContext: { requestId: 'req-web' },
      } as any;

      const webResult = await initUploadHandler(webEvent);

      expect(agentResult.statusCode).toBe(200);
      expect(webResult.statusCode).toBe(200);

      const agentBody = JSON.parse(agentResult.body);
      const webBody = JSON.parse(webResult.body);

      expect(agentBody).toHaveProperty('documentId');
      expect(agentBody).toHaveProperty('uploadUrl');
      expect(agentBody).toHaveProperty('expiresAt');

      expect(webBody).toHaveProperty('documentId');
      expect(webBody).toHaveProperty('uploadUrl');
      expect(webBody).toHaveProperty('expiresAt');

      expect(Object.keys(agentBody).sort()).toEqual(Object.keys(webBody).sort());
    });

    it('should create metadata record for both agent and web uploads', async () => {
      const mockToken = 'mock-token';
      const mockAuthContext: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      jest.spyOn(require('../shared/auth'), 'validateToken').mockResolvedValue(mockAuthContext);
      jest.spyOn(require('../shared/auth'), 'extractToken').mockReturnValue(mockToken);

      const event = {
        headers: { Authorization: `Bearer ${mockToken}` },
        body: JSON.stringify({
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: { requestId: 'req-123' },
      } as any;

      await initUploadHandler(event);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO documents'),
        expect.arrayContaining([
          expect.any(String),
          'tenant-1',
          'test.pdf',
          'agent-1',
          'UPLOADING',
        ])
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_versions'),
        expect.any(Array)
      );
    });
  });
});

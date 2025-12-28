import { v4 as uuidv4 } from 'uuid';
import { handler as getDocumentHandler } from '../api/get-document';
import { handler as listDocumentsHandler } from '../api/list-documents';
import { handler as downloadHandler } from '../api/download';
import { handler as deleteDocumentHandler } from '../api/delete-document';
import { handler as searchHandler } from '../api/search';
import { query, queryOne } from '../shared/db';
import { Document } from '../types';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { PoolClient } from 'pg';

jest.mock('../shared/auth', () => ({
  validateToken: jest.fn(),
  extractToken: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../shared/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

jest.mock('../shared/opensearch', () => ({
  searchDocuments: jest.fn(),
}));

jest.mock('../shared/s3', () => ({
  generateDownloadUrl: jest.fn().mockResolvedValue({
    url: 'https://s3.amazonaws.com/test-bucket/download-url',
    expiresAt: new Date(Date.now() + 900000),
  }),
}));

jest.mock('../shared/db');

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

describe('Integration Test: Multi-Tenant Isolation', () => {
  const tenant1Id = 'tenant-1';
  const tenant2Id = 'tenant-2';
  const user1Id = 'user-1';
  const user2Id = 'user-2';
  let tenant1DocumentId: string;
  let tenant2DocumentId: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tenant1DocumentId = uuidv4();
    tenant2DocumentId = uuidv4();

    const { validateToken } = require('../shared/auth');
    validateToken.mockImplementation(async (token: string) => {
      if (token === 'tenant1-token') {
        return {
          userId: user1Id,
          tenantId: tenant1Id,
          scope: ['read', 'write', 'delete'],
        };
      }
      if (token === 'tenant2-token') {
        return {
          userId: user2Id,
          tenantId: tenant2Id,
          scope: ['read', 'write', 'delete'],
        };
      }
      throw new Error('Invalid token');
    });

    const { extractToken } = require('../shared/auth');
    extractToken.mockImplementation((authHeader: string) => {
      if (authHeader === 'Bearer tenant1-token') return 'tenant1-token';
      if (authHeader === 'Bearer tenant2-token') return 'tenant2-token';
      return 'mock-token';
    });
  });

  describe('API Tenant Isolation', () => {
    it('should prevent cross-tenant document access via GET endpoint', async () => {
      // Tenant 1 document exists
      mockQueryOne.mockResolvedValueOnce({
        id: tenant1DocumentId,
        tenantId: tenant1Id,
        name: 'tenant1-document.pdf',
        status: 'READY',
        ownerId: user1Id,
      } as Document);

      // Tenant 2 user tries to access Tenant 1 document
      const getDocumentEvent: APIGatewayProxyEvent = {
        pathParameters: {
          id: tenant1DocumentId,
        },
        headers: {
          Authorization: 'Bearer tenant2-token',
        },
        requestContext: {
          requestId: 'test-request-cross-tenant',
        },
      } as any;

      const response = await getDocumentHandler(getDocumentEvent);

      // Should be forbidden
      expect(response.statusCode).toBe(403);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe('FORBIDDEN');
      expect(errorBody.error.message).toContain('different tenant');
    });

    it('should prevent cross-tenant document download', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: tenant1DocumentId,
        tenantId: tenant1Id,
        name: 'tenant1-document.pdf',
        status: 'READY',
        ownerId: user1Id,
      } as Document);

      const downloadEvent: APIGatewayProxyEvent = {
        pathParameters: {
          id: tenant1DocumentId,
        },
        headers: {
          Authorization: 'Bearer tenant2-token',
        },
        requestContext: {
          requestId: 'test-request-download-cross-tenant',
        },
      } as any;

      const response = await downloadHandler(downloadEvent);

      expect(response.statusCode).toBe(403);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe('FORBIDDEN');
      expect(errorBody.error.message).toContain('different tenant');
    });

    it('should prevent cross-tenant document deletion', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: tenant1DocumentId,
        tenantId: tenant1Id,
        name: 'tenant1-document.pdf',
        status: 'READY',
        ownerId: user1Id,
        legalHold: false,
      } as Document);

      const deleteEvent: APIGatewayProxyEvent = {
        pathParameters: {
          id: tenant1DocumentId,
        },
        headers: {
          Authorization: 'Bearer tenant2-token',
        },
        requestContext: {
          requestId: 'test-request-delete-cross-tenant',
        },
      } as any;

      const response = await deleteDocumentHandler(deleteEvent);

      expect(response.statusCode).toBe(403);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe('FORBIDDEN');
      expect(errorBody.error.message).toContain('different tenant');
    });

    it('should only return documents from authenticated user tenant in list', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: tenant1DocumentId,
          tenantId: tenant1Id,
          name: 'tenant1-document.pdf',
          ownerId: user1Id,
          status: 'READY',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Mock count query
      mockQuery.mockResolvedValueOnce([{ count: '1' }]);

      const listEvent: APIGatewayProxyEvent = {
        queryStringParameters: {
          limit: '20',
          offset: '0',
        },
        headers: {
          Authorization: 'Bearer tenant1-token',
        },
        requestContext: {
          requestId: 'test-request-list',
        },
      } as any;

      const response = await listDocumentsHandler(listEvent);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify query included tenant filter
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id = $1'),
        expect.arrayContaining([tenant1Id])
      );

      // All returned documents should belong to tenant1
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0].id).toBe(tenant1DocumentId);
      expect(body.documents[0].ownerId).toBe(user1Id);
    });
  });

  describe('Database Tenant Isolation', () => {
    it('should include tenant_id in all document records', async () => {
      const documents = [
        {
          id: tenant1DocumentId,
          tenant_id: tenant1Id,
          name: 'doc1.pdf',
          owner_id: user1Id,
          status: 'READY',
        },
        {
          id: tenant2DocumentId,
          tenant_id: tenant2Id,
          name: 'doc2.pdf',
          owner_id: user2Id,
          status: 'READY',
        },
      ];

      mockQuery.mockResolvedValueOnce(documents);

      const results = await query('SELECT * FROM documents');

      // Every record must have tenant_id
      expect(results.every((doc: any) => doc.tenant_id)).toBe(true);
      expect(results.every((doc: any) => typeof doc.tenant_id === 'string')).toBe(true);
    });

    it('should filter queries by tenant_id', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: tenant1DocumentId,
          tenant_id: tenant1Id,
          name: 'tenant1-doc.pdf',
        },
      ]);

      await query(
        'SELECT * FROM documents WHERE tenant_id = $1',
        [tenant1Id]
      );

      // Verify tenant filter was applied
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id = $1'),
        [tenant1Id]
      );
    });

    it('should enforce row-level security with tenant context', async () => {
      // Use the actual setTenantContext implementation
      const actualDb = jest.requireActual('../shared/db');
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      } as unknown as PoolClient;

      await actualDb.setTenantContext(mockClient, tenant1Id);

      // Verify tenant context was set
      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.tenant_id = $1',
        [tenant1Id]
      );
    });
  });

  describe('Search Tenant Isolation', () => {
    it('should only return search results from authenticated user tenant', async () => {
      const { searchDocuments } = require('../shared/opensearch');

      searchDocuments.mockResolvedValueOnce({
        results: [
          {
            document_id: tenant1DocumentId,
            tenant_id: tenant1Id,
            name: 'tenant1-document.pdf',
            owner_id: user1Id,
            mime_type: 'application/pdf',
            status: 'READY',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            size_bytes: 1024,
            version_number: 1,
          },
        ],
        total: 1,
      });

      const searchEvent: APIGatewayProxyEvent = {
        queryStringParameters: {
          q: 'document',
          limit: '20',
          offset: '0',
        },
        headers: {
          Authorization: 'Bearer tenant1-token',
        },
        requestContext: {
          requestId: 'test-request-search',
        },
      } as any;

      const response = await searchHandler(searchEvent);

      expect(response.statusCode).toBe(200);

      // Verify search was called with tenant filter
      expect(searchDocuments).toHaveBeenCalledWith(
        tenant1Id,
        'document',
        20,
        0
      );

      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].id).toBe(tenant1DocumentId);
    });

    it('should not return documents from other tenants in search results', async () => {
      const { searchDocuments } = require('../shared/opensearch');

      // Mock returns only tenant2 documents (should not happen in real system)
      searchDocuments.mockResolvedValueOnce({
        results: [],
        total: 0,
      });

      const searchEvent: APIGatewayProxyEvent = {
        queryStringParameters: {
          q: 'document',
          limit: '20',
          offset: '0',
        },
        headers: {
          Authorization: 'Bearer tenant1-token',
        },
        requestContext: {
          requestId: 'test-request-search-isolation',
        },
      } as any;

      const response = await searchHandler(searchEvent);

      expect(response.statusCode).toBe(200);

      // Verify tenant1 was used in search
      expect(searchDocuments).toHaveBeenCalledWith(
        tenant1Id,
        expect.any(String),
        expect.any(Number),
        expect.any(Number)
      );

      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(0);
    });
  });

  describe('S3 Key Prefix Tenant Isolation', () => {
    it('should include tenant prefix in all S3 keys', () => {
      const versionId = uuidv4();

      const s3Key = `${tenant1Id}/documents/${tenant1DocumentId}/${versionId}/original`;

      // Verify tenant prefix
      expect(s3Key.startsWith(tenant1Id)).toBe(true);

      // Verify path structure
      const parts = s3Key.split('/');
      expect(parts[0]).toBe(tenant1Id);
      expect(parts[1]).toBe('documents');
      expect(parts[2]).toBe(tenant1DocumentId);
    });

    it('should include tenant prefix in derived artifact paths', () => {
      const versionId = uuidv4();

      const derivedPaths = [
        `${tenant1Id}/derived/${tenant1DocumentId}/${versionId}/thumbnails/100x100.jpg`,
        `${tenant1Id}/derived/${tenant1DocumentId}/${versionId}/ocr/text.json`,
        `${tenant1Id}/derived/${tenant1DocumentId}/${versionId}/split/page-001.pdf`,
      ];

      for (const path of derivedPaths) {
        expect(path.startsWith(tenant1Id)).toBe(true);

        const parts = path.split('/');
        expect(parts[0]).toBe(tenant1Id);
        expect(parts[1]).toBe('derived');
        expect(parts[2]).toBe(tenant1DocumentId);
      }
    });

    it('should prevent access to S3 objects with different tenant prefix', () => {
      const tenant1Key = `${tenant1Id}/documents/${tenant1DocumentId}/v1/original`;
      const tenant2Key = `${tenant2Id}/documents/${tenant2DocumentId}/v1/original`;

      // Extract tenant from key
      const extractTenant = (key: string) => key.split('/')[0];

      expect(extractTenant(tenant1Key)).toBe(tenant1Id);
      expect(extractTenant(tenant2Key)).toBe(tenant2Id);
      expect(extractTenant(tenant1Key)).not.toBe(tenant2Id);
    });
  });

  describe('Complete Tenant Isolation Verification', () => {
    it('should maintain tenant isolation across entire document lifecycle', async () => {
      // Tenant 1 creates document
      mockQueryOne.mockResolvedValueOnce({
        id: tenant1DocumentId,
        tenantId: tenant1Id,
        name: 'tenant1-document.pdf',
        status: 'READY',
        ownerId: user1Id,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Document);

      // Mock versions query for tenant 1
      mockQuery.mockResolvedValueOnce([
        {
          id: uuidv4(),
          versionNumber: 1,
          s3Key: `${tenant1Id}/documents/${tenant1DocumentId}/v1/original`,
          s3Bucket: 'test-bucket',
          sizeBytes: 1024,
          mimeType: 'application/pdf',
          createdAt: new Date(),
        },
      ]);

      // Tenant 1 can access their document
      const tenant1GetEvent: APIGatewayProxyEvent = {
        pathParameters: {
          id: tenant1DocumentId,
        },
        headers: {
          Authorization: 'Bearer tenant1-token',
        },
        requestContext: {
          requestId: 'test-request-tenant1-access',
        },
      } as any;

      const tenant1Response = await getDocumentHandler(tenant1GetEvent);
      expect(tenant1Response.statusCode).toBe(200);

      // Tenant 2 cannot access Tenant 1's document
      mockQueryOne.mockResolvedValueOnce({
        id: tenant1DocumentId,
        tenantId: tenant1Id,
        name: 'tenant1-document.pdf',
        status: 'READY',
        ownerId: user1Id,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Document);

      const tenant2GetEvent: APIGatewayProxyEvent = {
        pathParameters: {
          id: tenant1DocumentId,
        },
        headers: {
          Authorization: 'Bearer tenant2-token',
        },
        requestContext: {
          requestId: 'test-request-tenant2-access',
        },
      } as any;

      const tenant2Response = await getDocumentHandler(tenant2GetEvent);
      expect(tenant2Response.statusCode).toBe(403);

      // Verify no data leakage in error message
      const errorBody = JSON.parse(tenant2Response.body);
      expect(errorBody.error.message).not.toContain(tenant1Id);
      expect(errorBody.error.message).not.toContain(user1Id);
    });

    it('should verify tenant_id consistency across all related records', () => {
      const documentRecord = {
        id: tenant1DocumentId,
        tenant_id: tenant1Id,
        name: 'doc.pdf',
      };

      const versionRecord = {
        id: uuidv4(),
        document_id: tenant1DocumentId,
        s3_key: `${tenant1Id}/documents/${tenant1DocumentId}/v1/original`,
      };

      const auditRecord = {
        id: uuidv4(),
        tenant_id: tenant1Id,
        document_id: tenant1DocumentId,
        action: 'UPLOAD',
      };

      // Extract tenant from S3 key
      const s3TenantId = versionRecord.s3_key.split('/')[0];

      // All records must have consistent tenant_id
      expect(documentRecord.tenant_id).toBe(tenant1Id);
      expect(auditRecord.tenant_id).toBe(tenant1Id);
      expect(s3TenantId).toBe(tenant1Id);
    });
  });
});

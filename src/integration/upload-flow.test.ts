import { v4 as uuidv4 } from 'uuid';
import { handler as initUploadHandler } from '../api/init-upload';
import { handler as searchHandler } from '../api/search';
import { handler as downloadHandler } from '../api/download';
import { handler as indexDocumentHandler } from '../workers/index-document';
import { query, queryOne } from '../shared/db';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('../shared/auth', () => ({
  validateToken: jest.fn().mockResolvedValue({
    userId: 'test-user-1',
    tenantId: 'test-tenant-1',
    scope: ['upload', 'read'],
  }),
  extractToken: jest.fn().mockReturnValue('mock-token'),
  hasUploadScope: jest.fn().mockReturnValue(true),
}));

jest.mock('../shared/s3', () => ({
  generateUploadUrl: jest.fn().mockResolvedValue({
    url: 'https://s3.amazonaws.com/test-bucket/presigned-url',
    expiresAt: new Date(Date.now() + 900000),
  }),
  generateDownloadUrl: jest.fn().mockResolvedValue({
    url: 'https://s3.amazonaws.com/test-bucket/download-url',
    expiresAt: new Date(Date.now() + 900000),
  }),
  getKmsKeyForTenant: jest.fn().mockReturnValue('test-kms-key'),
  getS3Client: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({
      Body: {
        transformToString: jest.fn().mockResolvedValue(
          JSON.stringify({ text: 'Sample extracted text from OCR' })
        ),
      },
    }),
  }),
}));

jest.mock('../shared/opensearch', () => ({
  indexDocument: jest.fn().mockResolvedValue(undefined),
  searchDocuments: jest.fn().mockImplementation((tenantId) => {
    return Promise.resolve({
      results: [
        {
          document_id: 'dynamic-doc-id',
          tenant_id: tenantId,
          name: 'test-document.pdf',
          owner_id: 'test-user-1',
          mime_type: 'application/pdf',
          status: 'READY',
          extracted_text: 'Sample extracted text from OCR',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          size_bytes: 1024,
          version_number: 1,
        },
      ],
      total: 1,
    });
  }),
}));

jest.mock('../shared/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

jest.mock('../shared/db');

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

describe('Integration Test: Complete Upload Flow', () => {
  const testTenantId = 'test-tenant-1';
  const testUserId = 'test-user-1';
  let testDocumentId: string;
  let testVersionId: string;

  beforeEach(() => {
    jest.clearAllMocks();
    testDocumentId = uuidv4();
    testVersionId = uuidv4();

    mockQueryOne.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id, name, kms_key_arn FROM tenants')) {
        return {
          id: testTenantId,
          name: 'Test Tenant',
          kmsKeyArn: null,
        };
      }
      if (text.includes('FROM documents') && text.includes('status !=')) {
        return {
          id: testDocumentId,
          tenantId: testTenantId,
          name: 'test-document.pdf',
          status: 'READY',
          ownerId: testUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      if (text.includes('FROM document_versions')) {
        return {
          id: testVersionId,
          documentId: testDocumentId,
          versionNumber: 1,
          s3Key: `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`,
          s3Bucket: 'test-bucket',
          sha256: 'test-hash',
          sizeBytes: 1024,
          mimeType: 'application/pdf',
          createdAt: new Date(),
        };
      }
      return null;
    });

    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id, tenant_id, name, owner_id, status')) {
        return [
          {
            id: testDocumentId,
            tenant_id: testTenantId,
            name: 'test-document.pdf',
            owner_id: testUserId,
            status: 'READY',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      if (text.includes('SELECT id, version_number, s3_key')) {
        return [
          {
            id: testVersionId,
            version_number: 1,
            s3_key: `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`,
            s3_bucket: 'test-bucket',
            size_bytes: 1024,
            mime_type: 'application/pdf',
          },
        ];
      }
      return [];
    });
  });

  it('should complete full upload → process → index → search → download flow', async () => {
    // Step 1: Initiate Upload
    const initUploadEvent: APIGatewayProxyEvent = {
      body: JSON.stringify({
        fileName: 'test-document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-1',
      },
    } as any;

    const initUploadResponse = await initUploadHandler(initUploadEvent);
    expect(initUploadResponse.statusCode).toBe(200);

    const initUploadBody = JSON.parse(initUploadResponse.body);
    expect(initUploadBody.documentId).toBeDefined();
    expect(initUploadBody.uploadUrl).toBeDefined();
    expect(initUploadBody.expiresAt).toBeDefined();

    testDocumentId = initUploadBody.documentId;

    // Verify document created with UPLOADING status
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO documents'),
      expect.arrayContaining([
        expect.any(String),
        testTenantId,
        'test-document.pdf',
        testUserId,
        'UPLOADING',
      ])
    );

    // Step 2: Simulate Upload Complete (S3 event triggers status update)
    // No need to mock here - the mockImplementation handles all queries

    // Step 3: Simulate Processing (Index Document)
    const indexEvent = {
      documentId: testDocumentId,
      versionId: testVersionId,
      tenantId: testTenantId,
    };

    const indexResult = await indexDocumentHandler(indexEvent);
    expect(indexResult.documentId).toBe(testDocumentId);

    // Verify document was indexed
    const { indexDocument } = require('../shared/opensearch');
    expect(indexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: testDocumentId,
        tenant_id: testTenantId,
        name: 'test-document.pdf',
        status: 'READY',
      })
    );

    // Step 4: Search for Document
    const searchEvent: APIGatewayProxyEvent = {
      queryStringParameters: {
        q: 'test-document',
        limit: '20',
        offset: '0',
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-2',
      },
    } as any;

    const searchResponse = await searchHandler(searchEvent);
    expect(searchResponse.statusCode).toBe(200);

    const searchBody = JSON.parse(searchResponse.body);
    expect(searchBody.results).toHaveLength(1);
    expect(searchBody.results[0].name).toBe('test-document.pdf');
    expect(searchBody.results[0].status).toBe('READY');

    // Step 5: Download Document
    // The mockImplementation already handles this - no need for additional mocks

    const downloadEvent: APIGatewayProxyEvent = {
      pathParameters: {
        id: testDocumentId,
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-3',
      },
    } as any;

    const downloadResponse = await downloadHandler(downloadEvent);
    expect(downloadResponse.statusCode).toBe(200);

    const downloadBody = JSON.parse(downloadResponse.body);
    expect(downloadBody.downloadUrl).toBeDefined();
    expect(downloadBody.expiresAt).toBeDefined();

    // Verify audit logs were created for each action
    const { createAuditLog } = require('../shared/audit');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPLOAD',
        documentId: testDocumentId,
        tenantId: testTenantId,
        userId: testUserId,
      })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOWNLOAD',
        documentId: testDocumentId,
        tenantId: testTenantId,
        userId: testUserId,
      })
    );
  });

  it('should handle upload with OCR text extraction', async () => {
    // Initiate upload
    const initUploadEvent: APIGatewayProxyEvent = {
      body: JSON.stringify({
        fileName: 'scanned-document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      }),
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-ocr',
      },
    } as any;

    const initUploadResponse = await initUploadHandler(initUploadEvent);
    expect(initUploadResponse.statusCode).toBe(200);

    const initUploadBody = JSON.parse(initUploadResponse.body);
    testDocumentId = initUploadBody.documentId;

    // Index document with OCR text
    const indexEvent = {
      documentId: testDocumentId,
      versionId: testVersionId,
      tenantId: testTenantId,
    };

    await indexDocumentHandler(indexEvent);

    // Verify OCR text was included in index
    const { indexDocument } = require('../shared/opensearch');
    expect(indexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        extracted_text: 'Sample extracted text from OCR',
      })
    );

    // Search should find document by extracted text
    const searchEvent: APIGatewayProxyEvent = {
      queryStringParameters: {
        q: 'extracted text',
        limit: '20',
        offset: '0',
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-search-ocr',
      },
    } as any;

    const searchResponse = await searchHandler(searchEvent);
    expect(searchResponse.statusCode).toBe(200);

    const searchBody = JSON.parse(searchResponse.body);
    expect(searchBody.results).toHaveLength(1);
    expect(searchBody.results[0].extractedText).toContain('extracted text');
  });

  it('should enforce tenant isolation throughout the flow', async () => {
    const { validateToken } = require('../shared/auth');

    // User from tenant-2 tries to access document from tenant-1
    validateToken.mockResolvedValueOnce({
      userId: 'test-user-2',
      tenantId: 'test-tenant-2',
      scope: ['read'],
    });

    const downloadEvent: APIGatewayProxyEvent = {
      pathParameters: {
        id: testDocumentId,
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-cross-tenant',
      },
    } as any;

    const downloadResponse = await downloadHandler(downloadEvent);

    // Should be forbidden
    expect(downloadResponse.statusCode).toBe(403);
    const errorBody = JSON.parse(downloadResponse.body);
    expect(errorBody.error.code).toBe('FORBIDDEN');
  });
});

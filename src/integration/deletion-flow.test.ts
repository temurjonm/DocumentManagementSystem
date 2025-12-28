import { v4 as uuidv4 } from 'uuid';
import { handler as deleteDocumentHandler } from '../api/delete-document';
import { handler as retentionEnforcementHandler } from '../workers/retention-enforcement';
import { processMessage as hardDeleteProcessor } from '../workers/hard-delete-worker';
import { query, queryOne } from '../shared/db';
import { Document } from '../types';
import { APIGatewayProxyEvent, ScheduledEvent, SQSRecord } from 'aws-lambda';

jest.mock('../shared/auth', () => ({
  validateToken: jest.fn().mockResolvedValue({
    userId: 'test-user-1',
    tenantId: 'test-tenant-1',
    scope: ['delete'],
  }),
  extractToken: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../shared/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

jest.mock('../shared/db');
jest.mock('@aws-sdk/client-s3');

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

// Mock withTransaction
const { withTransaction } = require('../shared/db');
const mockWithTransaction = withTransaction as jest.MockedFunction<any>;

describe('Integration Test: Deletion Flow', () => {
  const testTenantId = 'test-tenant-1';
  const testUserId = 'test-user-1';
  let testDocumentId: string;

  beforeEach(() => {
    jest.clearAllMocks();
    testDocumentId = uuidv4();

    // Mock S3 client
    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.prototype.send = jest.fn().mockResolvedValue({
      Contents: [
        { Key: `${testTenantId}/documents/${testDocumentId}/v1/original` },
        { Key: `${testTenantId}/derived/${testDocumentId}/v1/thumbnail.jpg` },
      ],
    });

    // Mock withTransaction to execute the callback immediately
    mockWithTransaction.mockImplementation(async (callback: any) => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      return callback(mockClient);
    });
  });

  it('should complete full soft delete → retention → hard delete flow', async () => {
    // Step 1: Soft Delete
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'test-document.pdf',
      ownerId: testUserId,
      status: 'READY',
      legalHold: false,
      deletedAt: undefined,
      retentionDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Document);

    const deleteEvent: APIGatewayProxyEvent = {
      pathParameters: {
        id: testDocumentId,
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-delete',
      },
    } as any;

    const deleteResponse = await deleteDocumentHandler(deleteEvent);
    expect(deleteResponse.statusCode).toBe(200);

    const deleteBody = JSON.parse(deleteResponse.body);
    expect(deleteBody.status).toBe('soft_deleted');
    expect(deleteBody.documentId).toBe(testDocumentId);

    // Verify document status updated to DELETED
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents'),
      expect.arrayContaining(['DELETED', expect.any(Date), testDocumentId])
    );

    // Verify audit log created
    const { createAuditLog } = require('../shared/audit');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        documentId: testDocumentId,
        tenantId: testTenantId,
        userId: testUserId,
      })
    );

    // Step 2: Retention Enforcement (runs daily)
    const deletedDate = new Date();
    deletedDate.setDate(deletedDate.getDate() - 31); // 31 days ago

    mockQuery.mockResolvedValueOnce([
      {
        id: testDocumentId,
        tenantId: testTenantId,
        name: 'test-document.pdf',
        deletedAt: deletedDate,
        retentionDays: 30,
      },
    ]);

    const scheduledEvent: ScheduledEvent = {
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Scheduled Event',
      source: 'aws.events',
      account: '123456789012',
      time: new Date().toISOString(),
      region: 'us-east-1',
      resources: ['arn:aws:events:us-east-1:123456789012:rule/retention-enforcement'],
      detail: {},
    };

    await retentionEnforcementHandler(scheduledEvent);

    // Verify document marked as DELETING
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents'),
      expect.arrayContaining(['DELETING', testDocumentId])
    );

    // Step 3: Hard Delete Worker
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'test-document.pdf',
      status: 'DELETING',
    } as Document);

    mockQuery.mockResolvedValueOnce([
      {
        id: 'version-1',
        s3Key: `${testTenantId}/documents/${testDocumentId}/v1/original`,
        s3Bucket: 'test-bucket',
      },
    ]);

    const sqsRecord: SQSRecord = {
      messageId: 'test-message-id',
      receiptHandle: 'test-receipt-handle',
      body: JSON.stringify({
        documentId: testDocumentId,
        tenantId: testTenantId,
      }),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: Date.now().toString(),
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: Date.now().toString(),
      },
      messageAttributes: {},
      md5OfBody: 'test-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
      awsRegion: 'us-east-1',
    };

    await hardDeleteProcessor(sqsRecord);

    // Verify S3 objects deleted
    const { S3Client } = require('@aws-sdk/client-s3');
    expect(S3Client.prototype.send).toHaveBeenCalled();

    // Verify withTransaction was called (which handles all DELETE operations)
    expect(mockWithTransaction).toHaveBeenCalled();
  });

  it('should prevent deletion of documents with legal hold', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'legal-document.pdf',
      ownerId: testUserId,
      status: 'READY',
      legalHold: true,
      deletedAt: undefined,
      retentionDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Document);

    const deleteEvent: APIGatewayProxyEvent = {
      pathParameters: {
        id: testDocumentId,
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-legal-hold',
      },
    } as any;

    const deleteResponse = await deleteDocumentHandler(deleteEvent);

    // Should be rejected with conflict error
    expect(deleteResponse.statusCode).toBe(409);
    const errorBody = JSON.parse(deleteResponse.body);
    expect(errorBody.error.code).toBe('CONFLICT');
    expect(errorBody.error.message).toContain('legal hold');
  });

  it('should exclude soft-deleted documents from retention enforcement if within retention period', async () => {
    const recentDeleteDate = new Date();
    recentDeleteDate.setDate(recentDeleteDate.getDate() - 15); // 15 days ago

    // Mock query returns no documents (retention period not exceeded)
    mockQuery.mockResolvedValueOnce([]);

    const scheduledEvent: ScheduledEvent = {
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Scheduled Event',
      source: 'aws.events',
      account: '123456789012',
      time: new Date().toISOString(),
      region: 'us-east-1',
      resources: ['arn:aws:events:us-east-1:123456789012:rule/retention-enforcement'],
      detail: {},
    };

    await retentionEnforcementHandler(scheduledEvent);

    // Verify no documents were marked for deletion
    const updateCalls = mockQuery.mock.calls.filter((call) =>
      call[0].includes('UPDATE documents') && call[0].includes('DELETING')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('should preserve audit logs after hard delete', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'test-document.pdf',
      status: 'DELETING',
    } as Document);

    mockQuery.mockResolvedValueOnce([
      {
        id: 'version-1',
        s3Key: `${testTenantId}/documents/${testDocumentId}/v1/original`,
        s3Bucket: 'test-bucket',
      },
    ]);

    // Track what queries are called in the transaction
    let transactionQueries: string[] = [];
    mockWithTransaction.mockImplementation(async (callback: any) => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql: string) => {
          transactionQueries.push(sql);
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    const sqsRecord: SQSRecord = {
      messageId: 'test-message-id',
      receiptHandle: 'test-receipt-handle',
      body: JSON.stringify({
        documentId: testDocumentId,
        tenantId: testTenantId,
      }),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: Date.now().toString(),
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: Date.now().toString(),
      },
      messageAttributes: {},
      md5OfBody: 'test-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
      awsRegion: 'us-east-1',
    };

    await hardDeleteProcessor(sqsRecord);

    // Verify audit_logs table was NOT deleted
    const auditLogDeleteCalls = transactionQueries.filter((sql) =>
      sql.includes('audit_logs')
    );

    expect(auditLogDeleteCalls).toHaveLength(0);

    // Verify other tables were deleted
    expect(transactionQueries.some((sql) => sql.includes('processing_jobs'))).toBe(true);
    expect(transactionQueries.some((sql) => sql.includes('document_versions'))).toBe(true);
    expect(transactionQueries.some((sql) => sql.includes('documents'))).toBe(true);
  });

  it('should handle documents already in DELETED status', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'test-document.pdf',
      ownerId: testUserId,
      status: 'DELETED',
      legalHold: false,
      deletedAt: new Date(),
    } as Document);

    const deleteEvent: APIGatewayProxyEvent = {
      pathParameters: {
        id: testDocumentId,
      },
      headers: {
        Authorization: 'Bearer mock-token',
      },
      requestContext: {
        requestId: 'test-request-already-deleted',
      },
    } as any;

    const deleteResponse = await deleteDocumentHandler(deleteEvent);

    // Should be rejected with conflict error
    expect(deleteResponse.statusCode).toBe(409);
    const errorBody = JSON.parse(deleteResponse.body);
    expect(errorBody.error.code).toBe('CONFLICT');
    expect(errorBody.error.message).toContain('already deleted');
  });

  it('should delete all S3 objects including derived artifacts', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: testDocumentId,
      tenantId: testTenantId,
      name: 'test-document.pdf',
      status: 'DELETING',
    } as Document);

    mockQuery.mockResolvedValueOnce([
      {
        id: 'version-1',
        s3Key: `${testTenantId}/documents/${testDocumentId}/v1/original`,
        s3Bucket: 'test-bucket',
      },
    ]);

    const { S3Client } = require('@aws-sdk/client-s3');

    // Mock list objects for both document and derived prefixes
    const mockSend = jest
      .fn()
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${testTenantId}/documents/${testDocumentId}/v1/original` },
        ],
      })
      .mockResolvedValueOnce({}) // Delete response
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${testTenantId}/derived/${testDocumentId}/v1/thumbnail.jpg` },
          { Key: `${testTenantId}/derived/${testDocumentId}/v1/ocr/text.json` },
        ],
      })
      .mockResolvedValueOnce({}); // Delete response

    S3Client.prototype.send = mockSend;

    // Track what queries are called in the transaction
    let transactionQueries: string[] = [];
    mockWithTransaction.mockImplementation(async (callback: any) => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql: string) => {
          transactionQueries.push(sql);
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    const sqsRecord: SQSRecord = {
      messageId: 'test-message-id',
      receiptHandle: 'test-receipt-handle',
      body: JSON.stringify({
        documentId: testDocumentId,
        tenantId: testTenantId,
      }),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: Date.now().toString(),
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: Date.now().toString(),
      },
      messageAttributes: {},
      md5OfBody: 'test-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
      awsRegion: 'us-east-1',
    };

    await hardDeleteProcessor(sqsRecord);

    // Verify S3 send was called (4 times: 2 list + 2 delete operations)
    expect(mockSend).toHaveBeenCalledTimes(4);
    
    // Verify database records were deleted via transaction
    expect(transactionQueries.some((sql) => sql.includes('processing_jobs'))).toBe(true);
    expect(transactionQueries.some((sql) => sql.includes('document_versions'))).toBe(true);
    expect(transactionQueries.some((sql) => sql.includes('documents'))).toBe(true);
  });
});

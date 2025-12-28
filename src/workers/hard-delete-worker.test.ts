import { processMessage } from './hard-delete-worker';
import { SQSRecord } from 'aws-lambda';
import * as db from '../shared/db';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

jest.mock('../shared/db');
jest.mock('@aws-sdk/client-s3');

const mockQueryOne = db.queryOne as jest.MockedFunction<typeof db.queryOne>;
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockWithTransaction = db.withTransaction as jest.MockedFunction<
  typeof db.withTransaction
>;

const mockS3Send = jest.fn();
(S3Client as jest.MockedClass<typeof S3Client>).prototype.send = mockS3Send;

describe('Hard Delete Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockReset();
  });

  const createMockRecord = (
    documentId: string,
    tenantId: string
  ): SQSRecord => ({
    messageId: 'msg-123',
    receiptHandle: 'receipt-123',
    body: JSON.stringify({ documentId, tenantId }),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1234567890',
      SenderId: 'sender-id',
      ApproximateFirstReceiveTimestamp: '1234567890',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:queue',
    awsRegion: 'us-east-1',
  });

  it('should delete S3 objects and database records', async () => {
    const mockDocument = {
      id: 'doc-1',
      tenantId: 'tenant-1',
      name: 'test.pdf',
      status: 'DELETING',
    };

    const mockVersions = [
      {
        id: 'ver-1',
        s3Key: 'tenant-1/documents/doc-1/ver-1/original',
        s3Bucket: 'test-bucket',
      },
    ];

    mockQueryOne.mockResolvedValue(mockDocument);
    mockQuery.mockResolvedValue(mockVersions);

    mockS3Send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: [{ Key: 'tenant-1/documents/doc-1/ver-1/original' }],
        });
      }
      if (command instanceof DeleteObjectsCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (callback) => {
      return callback(mockClient as any);
    });

    const record = createMockRecord('doc-1', 'tenant-1');
    await processMessage(record);

    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, tenant_id'),
      ['doc-1', 'tenant-1']
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM processing_jobs'),
      ['doc-1']
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM document_versions'),
      ['doc-1']
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM documents'),
      ['doc-1']
    );
  });

  it('should skip if document not found', async () => {
    mockQueryOne.mockResolvedValue(null);

    const record = createMockRecord('doc-999', 'tenant-1');
    await processMessage(record);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('should skip if document not in DELETING status', async () => {
    const mockDocument = {
      id: 'doc-1',
      tenantId: 'tenant-1',
      name: 'test.pdf',
      status: 'READY',
    };

    mockQueryOne.mockResolvedValue(mockDocument);

    const record = createMockRecord('doc-1', 'tenant-1');
    await processMessage(record);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('should handle S3 deletion errors', async () => {
    const mockDocument = {
      id: 'doc-1',
      tenantId: 'tenant-1',
      name: 'test.pdf',
      status: 'DELETING',
    };

    mockQueryOne.mockResolvedValue(mockDocument);
    mockQuery.mockResolvedValue([]);

    mockS3Send.mockRejectedValue(new Error('S3 error'));

    const record = createMockRecord('doc-1', 'tenant-1');

    await expect(processMessage(record)).rejects.toThrow('S3 error');
  });

  it('should preserve audit logs during deletion', async () => {
    const mockDocument = {
      id: 'doc-1',
      tenantId: 'tenant-1',
      name: 'test.pdf',
      status: 'DELETING',
    };

    mockQueryOne.mockResolvedValue(mockDocument);
    mockQuery.mockResolvedValue([]);

    mockS3Send.mockResolvedValue({ Contents: [] });

    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (callback) => {
      return callback(mockClient as any);
    });

    const record = createMockRecord('doc-1', 'tenant-1');
    await processMessage(record);

    const queries = mockClient.query.mock.calls.map((call) => call[0]);
    expect(queries.some((q) => q.includes('DELETE FROM audit_logs'))).toBe(false);
  });
});

import { handler as successHandler } from './processing-success';
import { handler as failureHandler } from './processing-failure';
import * as db from '../shared/db';
import * as audit from '../shared/audit';

jest.mock('../shared/db');
jest.mock('../shared/audit');
jest.mock('../shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    clearContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockCreateAuditLog = audit.createAuditLog as jest.MockedFunction<
  typeof audit.createAuditLog
>;

describe('Processing Completion Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Processing Success Handler', () => {
    const mockSuccessEvent = {
      documentId: 'doc-123',
      versionId: 'ver-456',
      tenantId: 'tenant-789',
      processingResults: {
        malwareScan: { status: 'CLEAN' },
        ocr: { s3Key: 'tenant-789/derived/doc-123/ver-456/ocr/text.json', textLength: 1500 },
        thumbnails: [
          { size: 100, s3Key: 'tenant-789/derived/doc-123/ver-456/thumbnails/100x100.jpg' },
          { size: 300, s3Key: 'tenant-789/derived/doc-123/ver-456/thumbnails/300x300.jpg' },
        ],
      },
    };

    it('should update document status to READY on successful processing', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const result = await successHandler(mockSuccessEvent);

      expect(result.status).toBe('READY');
      expect(result.documentId).toBe('doc-123');
      expect(result.auditLogCreated).toBe(true);

      // Verify document status update
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'READY'"),
        ['doc-123']
      );
    });

    it('should mark all processing jobs as COMPLETED', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      await successHandler(mockSuccessEvent);

      // Verify processing jobs update
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'COMPLETED'"),
        ['doc-123', 'ver-456']
      );
    });

    it('should create audit log with PROCESS_COMPLETE action', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      await successHandler(mockSuccessEvent);

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        tenantId: 'tenant-789',
        action: 'PROCESS_COMPLETE',
        documentId: 'doc-123',
        metadata: expect.objectContaining({
          versionId: 'ver-456',
          processingResults: mockSuccessEvent.processingResults,
        }),
      });
    });

    it('should handle success without processing results', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const eventWithoutResults = {
        documentId: 'doc-123',
        versionId: 'ver-456',
        tenantId: 'tenant-789',
      };

      const result = await successHandler(eventWithoutResults);

      expect(result.status).toBe('READY');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockCreateAuditLog).toHaveBeenCalled();
    });

    it('should throw error if database update fails', async () => {
      mockQuery.mockRejectedValue(new Error('Database connection failed'));

      await expect(successHandler(mockSuccessEvent)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('Processing Failure Handler', () => {
    const mockFailureEvent = {
      documentId: 'doc-123',
      versionId: 'ver-456',
      tenantId: 'tenant-789',
      error: {
        message: 'Malware detected: Win.Test.EICAR',
        code: 'MALWARE_DETECTED',
        jobType: 'MALWARE_SCAN',
      },
    };

    it('should update document status to FAILED on processing failure', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const result = await failureHandler(mockFailureEvent);

      expect(result.status).toBe('FAILED');
      expect(result.documentId).toBe('doc-123');
      expect(result.errorRecorded).toBe(true);
      expect(result.auditLogCreated).toBe(true);

      // Verify document status update
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'FAILED'"),
        ['doc-123']
      );
    });

    it('should record error message in processing jobs', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      await failureHandler(mockFailureEvent);

      // Verify processing jobs update with error message
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'FAILED'"),
        ['Malware detected: Win.Test.EICAR', 'doc-123', 'ver-456']
      );
    });

    it('should create audit log with PROCESS_FAILED action', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      await failureHandler(mockFailureEvent);

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        tenantId: 'tenant-789',
        action: 'PROCESS_FAILED',
        documentId: 'doc-123',
        metadata: expect.objectContaining({
          versionId: 'ver-456',
          error: {
            message: 'Malware detected: Win.Test.EICAR',
            code: 'MALWARE_DETECTED',
            jobType: 'MALWARE_SCAN',
          },
        }),
      });
    });

    it('should handle error without code or jobType', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const minimalErrorEvent = {
        documentId: 'doc-123',
        versionId: 'ver-456',
        tenantId: 'tenant-789',
        error: {
          message: 'Processing timeout',
        },
      };

      const result = await failureHandler(minimalErrorEvent);

      expect(result.status).toBe('FAILED');
      expect(result.errorRecorded).toBe(true);
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            error: {
              message: 'Processing timeout',
              code: undefined,
              jobType: undefined,
            },
          }),
        })
      );
    });

    it('should throw error if database update fails', async () => {
      mockQuery.mockRejectedValue(new Error('Database connection failed'));

      await expect(failureHandler(mockFailureEvent)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle empty error message', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const eventWithEmptyError = {
        documentId: 'doc-123',
        versionId: 'ver-456',
        tenantId: 'tenant-789',
        error: {
          message: '',
        },
      };

      await failureHandler(eventWithEmptyError);

      // Should use 'Unknown error' as fallback
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'FAILED'"),
        ['Unknown error', 'doc-123', 'ver-456']
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle successful processing after previous failure', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const successEvent = {
        documentId: 'doc-123',
        versionId: 'ver-456',
        tenantId: 'tenant-789',
      };

      const result = await successHandler(successEvent);

      expect(result.status).toBe('READY');
      // Verify it updates status regardless of previous state
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'READY'"),
        ['doc-123']
      );
    });

    it('should handle multiple processing jobs for same document', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 3 } as any);
      mockCreateAuditLog.mockResolvedValue();

      const successEvent = {
        documentId: 'doc-123',
        versionId: 'ver-456',
        tenantId: 'tenant-789',
      };

      await successHandler(successEvent);

      // Should update all PENDING and RUNNING jobs
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('PENDING', 'RUNNING')"),
        ['doc-123', 'ver-456']
      );
    });
  });
});

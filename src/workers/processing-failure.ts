import { query } from '../shared/db';
import { createAuditLog } from '../shared/audit';
import { logger } from '../shared/logger';
import { metrics } from '../shared/metrics';

interface ProcessingFailureEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  error: {
    message: string;
    code?: string;
    jobType?: string;
  };
}

interface ProcessingFailureResult {
  documentId: string;
  status: string;
  errorRecorded: boolean;
  auditLogCreated: boolean;
}

export async function handler(
  event: ProcessingFailureEvent
): Promise<ProcessingFailureResult> {
  const { documentId, versionId, tenantId, error } = event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Processing failure handler started', { error });

  try {
    // Update document status to FAILED
    await query(
      `UPDATE documents
       SET status = 'FAILED', updated_at = NOW()
       WHERE id = $1`,
      [documentId]
    );

    logger.info('Document status updated to FAILED', { documentId });

    // Update processing jobs to record the error
    const errorMessage = error.message || 'Unknown error';
    await query(
      `UPDATE processing_jobs
       SET status = 'FAILED', 
           error_message = $1, 
           completed_at = NOW()
       WHERE document_id = $2 
         AND version_id = $3 
         AND status IN ('PENDING', 'RUNNING')`,
      [errorMessage, documentId, versionId]
    );

    logger.info('Processing jobs marked as failed', {
      documentId,
      versionId,
      errorMessage,
    });

    // Create audit log entry
    await createAuditLog({
      tenantId,
      action: 'PROCESS_FAILED',
      documentId,
      metadata: {
        versionId,
        error: {
          message: error.message,
          code: error.code,
          jobType: error.jobType,
        },
        failedAt: new Date().toISOString(),
      },
    });

    logger.info('Audit log created for processing failure', { documentId });

    // Record upload failure metric
    await metrics.recordUploadSuccess(tenantId, false);

    return {
      documentId,
      status: 'FAILED',
      errorRecorded: true,
      auditLogCreated: true,
    };
  } catch (err) {
    logger.error('Processing failure handler failed', err as Error);
    throw err;
  } finally {
    logger.clearContext();
  }
}

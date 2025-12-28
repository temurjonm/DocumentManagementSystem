import { query } from '../shared/db';
import { createAuditLog } from '../shared/audit';
import { logger } from '../shared/logger';
import { metrics } from '../shared/metrics';

interface ProcessingSuccessEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  processingResults?: {
    malwareScan?: { status: string };
    ocr?: { s3Key: string; textLength: number };
    thumbnails?: Array<{ size: number; s3Key: string }>;
    pdfSplit?: { pageCount: number };
  };
}

interface ProcessingSuccessResult {
  documentId: string;
  status: string;
  auditLogCreated: boolean;
}

export async function handler(
  event: ProcessingSuccessEvent
): Promise<ProcessingSuccessResult> {
  const { documentId, versionId, tenantId, processingResults } = event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Processing success handler started', { processingResults });

  try {
    // Update document status to READY
    await query(
      `UPDATE documents
       SET status = 'READY', updated_at = NOW()
       WHERE id = $1`,
      [documentId]
    );

    logger.info('Document status updated to READY', { documentId });

    // Update all processing jobs for this document to COMPLETED
    await query(
      `UPDATE processing_jobs
       SET status = 'COMPLETED', completed_at = NOW()
       WHERE document_id = $1 AND version_id = $2 AND status IN ('PENDING', 'RUNNING')`,
      [documentId, versionId]
    );

    logger.info('Processing jobs marked as completed', { documentId, versionId });

    // Create audit log entry
    await createAuditLog({
      tenantId,
      action: 'PROCESS_COMPLETE',
      documentId,
      metadata: {
        versionId,
        processingResults,
        completedAt: new Date().toISOString(),
      },
    });

    logger.info('Audit log created for processing completion', { documentId });

    // Record upload success metric
    await metrics.recordUploadSuccess(tenantId, true);

    return {
      documentId,
      status: 'READY',
      auditLogCreated: true,
    };
  } catch (error) {
    logger.error('Processing success handler failed', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

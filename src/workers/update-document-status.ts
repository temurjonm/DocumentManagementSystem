import { query } from '../shared/db';
import { logger } from '../shared/logger';
import { DocumentStatus } from '../types';

interface UpdateStatusEvent {
  documentId: string;
  status: DocumentStatus;
  error?: string;
}

export async function handler(event: UpdateStatusEvent): Promise<UpdateStatusEvent> {
  const { documentId, status, error } = event;
  
  logger.info('Updating document status', { documentId, status, error });

  try {
    await query(
      `UPDATE documents
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [status, documentId]
    );

    if (error) {
      await query(
        `UPDATE processing_jobs
         SET status = 'FAILED', error_message = $1, completed_at = NOW()
         WHERE document_id = $2 AND status = 'RUNNING'`,
        [error, documentId]
      );
    }

    logger.info('Document status updated', { documentId, status });

    return event;
  } catch (err) {
    logger.error('Failed to update document status', err as Error, { documentId, status });
    throw err;
  }
}

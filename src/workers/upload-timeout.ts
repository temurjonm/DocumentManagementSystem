import { ScheduledEvent } from 'aws-lambda';
import { query } from '../shared/db';
import { logger } from '../shared/logger';

const UPLOAD_TIMEOUT_MINUTES = 30;

export async function handler(_event: ScheduledEvent): Promise<void> {
  logger.info('Running upload timeout check');

  try {
    const timeoutThreshold = new Date(
      Date.now() - UPLOAD_TIMEOUT_MINUTES * 60 * 1000
    );

    const result = await query(
      `UPDATE documents 
       SET status = 'FAILED', updated_at = NOW()
       WHERE status = 'UPLOADING' 
       AND created_at < $1
       RETURNING id, tenant_id`,
      [timeoutThreshold]
    );

    if (result.length > 0) {
      logger.info('Marked timed-out uploads as failed', {
        count: result.length,
      });
    } else {
      logger.info('No timed-out uploads found');
    }
  } catch (error) {
    logger.error('Failed to process upload timeouts', error as Error);
    throw error;
  }
}

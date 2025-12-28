import { ScheduledEvent } from 'aws-lambda';
import { query } from '../shared/db';
import { logger } from '../shared/logger';
import { Document } from '../types';

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Starting retention enforcement job', {
    time: event.time,
    resources: event.resources,
  });

  try {
    const expiredDocuments = await query<Document>(
      `SELECT id, tenant_id, name, deleted_at, retention_days
       FROM documents
       WHERE status = $1
         AND deleted_at IS NOT NULL
         AND legal_hold = false
         AND NOW() - deleted_at > (retention_days || ' days')::INTERVAL`,
      ['DELETED']
    );

    logger.info('Found expired documents', {
      count: expiredDocuments.length,
    });

    if (expiredDocuments.length === 0) {
      logger.info('No documents to process');
      return;
    }

    for (const doc of expiredDocuments) {
      try {
        await query(
          `UPDATE documents
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          ['DELETING', doc.id]
        );

        logger.info('Document marked for hard delete', {
          documentId: doc.id,
          tenantId: doc.tenantId,
          documentName: doc.name,
          deletedAt: doc.deletedAt,
          retentionDays: doc.retentionDays,
        });
      } catch (error) {
        logger.error('Failed to mark document for deletion', error as Error, {
          documentId: doc.id,
          tenantId: doc.tenantId,
        });
      }
    }

    logger.info('Retention enforcement completed', {
      processed: expiredDocuments.length,
    });
  } catch (error) {
    logger.error('Retention enforcement job failed', error as Error);
    throw error;
  }
}

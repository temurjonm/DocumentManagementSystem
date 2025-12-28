import { ScheduledEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { query } from '../shared/db';
import { logger } from '../shared/logger';
import { Document } from '../types';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const HARD_DELETE_QUEUE_URL = process.env.HARD_DELETE_QUEUE_URL || '';

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Starting hard delete scheduling job', {
    time: event.time,
  });

  try {
    const documentsToDelete = await query<Document>(
      `SELECT id, tenant_id, name
       FROM documents
       WHERE status = $1
       ORDER BY updated_at ASC
       LIMIT 100`,
      ['DELETING']
    );

    logger.info('Found documents to hard delete', {
      count: documentsToDelete.length,
    });

    if (documentsToDelete.length === 0) {
      logger.info('No documents to schedule for hard delete');
      return;
    }

    for (const doc of documentsToDelete) {
      try {
        const command = new SendMessageCommand({
          QueueUrl: HARD_DELETE_QUEUE_URL,
          MessageBody: JSON.stringify({
            documentId: doc.id,
            tenantId: doc.tenantId,
          }),
          MessageAttributes: {
            documentId: {
              DataType: 'String',
              StringValue: doc.id,
            },
            tenantId: {
              DataType: 'String',
              StringValue: doc.tenantId,
            },
          },
        });

        await sqsClient.send(command);

        logger.info('Scheduled hard delete', {
          documentId: doc.id,
          tenantId: doc.tenantId,
          documentName: doc.name,
        });
      } catch (error) {
        logger.error('Failed to schedule hard delete', error as Error, {
          documentId: doc.id,
          tenantId: doc.tenantId,
        });
      }
    }

    logger.info('Hard delete scheduling completed', {
      scheduled: documentsToDelete.length,
    });
  } catch (error) {
    logger.error('Hard delete scheduling job failed', error as Error);
    throw error;
  }
}

import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { metrics } from '../shared/metrics';
import { logger } from '../shared/logger';

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface QueueConfig {
  name: string;
  url: string;
  isDLQ: boolean;
}

const QUEUES: QueueConfig[] = [
  {
    name: 'malware-scan',
    url: process.env.MALWARE_SCAN_QUEUE_URL || '',
    isDLQ: false,
  },
  {
    name: 'malware-scan-dlq',
    url: process.env.MALWARE_SCAN_DLQ_URL || '',
    isDLQ: true,
  },
  {
    name: 'thumbnail-generation',
    url: process.env.THUMBNAIL_QUEUE_URL || '',
    isDLQ: false,
  },
  {
    name: 'thumbnail-generation-dlq',
    url: process.env.THUMBNAIL_DLQ_URL || '',
    isDLQ: true,
  },
  {
    name: 'pdf-split',
    url: process.env.PDF_SPLIT_QUEUE_URL || '',
    isDLQ: false,
  },
  {
    name: 'pdf-split-dlq',
    url: process.env.PDF_SPLIT_DLQ_URL || '',
    isDLQ: true,
  },
];

export async function handler(): Promise<void> {
  logger.info('Queue metrics collection started');

  const results = await Promise.allSettled(
    QUEUES.filter((q) => q.url).map(async (queue) => {
      try {
        const command = new GetQueueAttributesCommand({
          QueueUrl: queue.url,
          AttributeNames: ['ApproximateNumberOfMessages'],
        });

        const response = await sqs.send(command);
        const messageCount = parseInt(
          response.Attributes?.ApproximateNumberOfMessages || '0',
          10
        );

        if (queue.isDLQ) {
          await metrics.recordDLQCount(queue.name, messageCount);
          logger.info('DLQ metrics recorded', {
            queueName: queue.name,
            count: messageCount,
          });
        } else {
          await metrics.recordQueueDepth(queue.name, messageCount);
          logger.info('Queue depth metrics recorded', {
            queueName: queue.name,
            depth: messageCount,
          });
        }
      } catch (error) {
        logger.error(`Failed to collect metrics for queue ${queue.name}`, error as Error, {
          queueName: queue.name,
          queueUrl: queue.url,
        });
        throw error;
      }
    })
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    logger.warn('Some queue metrics collection failed', {
      failureCount: failures.length,
      totalQueues: QUEUES.length,
    });
  }

  logger.info('Queue metrics collection completed', {
    successCount: results.filter((r) => r.status === 'fulfilled').length,
    failureCount: failures.length,
  });
}

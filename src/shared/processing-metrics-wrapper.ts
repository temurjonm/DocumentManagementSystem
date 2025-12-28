import { metrics } from './metrics';
import { logger } from './logger';

interface ProcessingEvent {
  tenantId: string;
  taskType: string;
  documentId?: string;
  versionId?: string;
  [key: string]: unknown;
}

type ProcessingHandler<T extends ProcessingEvent, R> = (event: T) => Promise<R>;

export function withProcessingMetrics<T extends ProcessingEvent, R>(
  taskType: string,
  handler: ProcessingHandler<T, R>
): ProcessingHandler<T, R> {
  return async (event: T): Promise<R> => {
    const startTime = Date.now();
    const { tenantId } = event;

    try {
      const result = await handler(event);
      const durationMs = Date.now() - startTime;

      await metrics.recordProcessingMetrics({
        tenantId,
        taskType,
        status: 'success',
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      await metrics.recordProcessingMetrics({
        tenantId,
        taskType,
        status: 'failure',
        durationMs,
      });

      logger.error(`Processing task ${taskType} failed`, error instanceof Error ? error : undefined, {
        tenantId,
        taskType,
        durationMs,
      });

      throw error;
    }
  };
}

import { logger } from './logger';
import { WorkerType, LAMBDA_TIMEOUT_MS, FARGATE_TIMEOUT_MS } from './task-routing';

export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface TimeoutConfig {
  timeoutMs: number;
  taskId?: string;
  onTimeout?: () => Promise<void>;
}

export function getTimeoutForWorker(workerType: WorkerType): number {
  return workerType === 'LAMBDA' ? LAMBDA_TIMEOUT_MS : FARGATE_TIMEOUT_MS;
}

export async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  config: TimeoutConfig
): Promise<T> {
  const { timeoutMs, taskId, onTimeout } = config;

  logger.info('Starting operation with timeout', {
    timeoutMs,
    timeoutSeconds: Math.round(timeoutMs / 1000),
    taskId,
  });

  const startTime = Date.now();

  return new Promise<T>(async (resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout | undefined;
    let operationCompleted = false;

    // Set up timeout
    timeoutHandle = setTimeout(async () => {
      if (operationCompleted) return;

      operationCompleted = true;
      const elapsedMs = Date.now() - startTime;

      logger.error('Operation timed out', new Error('Timeout'), {
        timeoutMs,
        elapsedMs,
        taskId,
      });

      // Execute cleanup callback if provided
      if (onTimeout) {
        try {
          await onTimeout();
        } catch (error) {
          logger.error('Timeout cleanup failed', error as Error, { taskId });
        }
      }

      reject(
        new TimeoutError(
          `Operation exceeded timeout of ${Math.round(timeoutMs / 1000)}s`,
          timeoutMs
        )
      );
    }, timeoutMs);

    try {
      // Execute the operation
      const result = await operation();

      if (!operationCompleted) {
        operationCompleted = true;
        clearTimeout(timeoutHandle);

        const elapsedMs = Date.now() - startTime;
        logger.info('Operation completed successfully', {
          elapsedMs,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          taskId,
        });

        resolve(result);
      }
    } catch (error) {
      if (!operationCompleted) {
        operationCompleted = true;
        clearTimeout(timeoutHandle);

        const elapsedMs = Date.now() - startTime;
        logger.error('Operation failed', error as Error, {
          elapsedMs,
          taskId,
        });

        reject(error);
      }
    }
  });
}

export interface TaskExecutionMetadata {
  startTime: number;
  timeoutMs: number;
  workerType: WorkerType;
}

export function createTaskExecutionMetadata(workerType: WorkerType): TaskExecutionMetadata {
  return {
    startTime: Date.now(),
    timeoutMs: getTimeoutForWorker(workerType),
    workerType,
  };
}

export function getRemainingTime(metadata: TaskExecutionMetadata): number {
  const elapsed = Date.now() - metadata.startTime;
  return Math.max(0, metadata.timeoutMs - elapsed);
}

export function hasTimedOut(metadata: TaskExecutionMetadata): boolean {
  return getRemainingTime(metadata) === 0;
}

export function getTimeoutProgress(metadata: TaskExecutionMetadata): number {
  const elapsed = Date.now() - metadata.startTime;
  return Math.min(1, elapsed / metadata.timeoutMs);
}

export async function executeTaskWithEnforcement<T>(
  operation: () => Promise<T>,
  workerType: WorkerType,
  taskId: string,
  onTimeout?: () => Promise<void>
): Promise<T> {
  const timeoutMs = getTimeoutForWorker(workerType);

  logger.info('Executing task with timeout enforcement', {
    workerType,
    timeoutMs,
    timeoutMinutes: Math.round(timeoutMs / 60000),
    taskId,
  });

  try {
    return await executeWithTimeout(operation, {
      timeoutMs,
      taskId,
      onTimeout,
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      logger.error('Task terminated due to timeout', error, {
        workerType,
        timeoutMs,
        taskId,
      });
    }
    throw error;
  }
}

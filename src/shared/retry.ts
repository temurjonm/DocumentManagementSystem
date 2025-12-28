import { logger } from './logger';

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  retryableErrors?: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 16000, // 16 seconds
  retryableErrors: [
    'NetworkError',
    'TimeoutError',
    'ServiceUnavailable',
    'ThrottlingException',
    'TooManyRequestsException',
    'InternalServerError',
  ],
};

export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs?: number
): number {
  // Exponential backoff: baseDelay * 2^(attempt - 1)
  // attempt 1: 1s, attempt 2: 2s, attempt 3: 4s, attempt 4: 8s, attempt 5: 16s
  const delay = baseDelayMs * Math.pow(2, attempt - 1);
  
  if (maxDelayMs) {
    return Math.min(delay, maxDelayMs);
  }
  
  return delay;
}

export function isRetryableError(error: Error, retryableErrors?: string[]): boolean {
  const errors = retryableErrors || DEFAULT_RETRY_CONFIG.retryableErrors!;
  
  return errors.some((errorType) => 
    error.name.includes(errorType) || 
    error.message.includes(errorType)
  );
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      logger.info('Attempting operation', { attempt, maxAttempts: finalConfig.maxAttempts });
      
      const result = await operation();
      
      if (attempt > 1) {
        logger.info('Operation succeeded after retry', { attempt });
      }
      
      return result;
    } catch (error) {
      lastError = error as Error;
      
      const isRetryable = isRetryableError(lastError, finalConfig.retryableErrors);
      const isLastAttempt = attempt === finalConfig.maxAttempts;

      logger.warn('Operation failed', {
        attempt,
        maxAttempts: finalConfig.maxAttempts,
        error: lastError.message,
        isRetryable,
        isLastAttempt,
      });

      if (isLastAttempt || !isRetryable) {
        logger.error('Operation failed permanently', lastError, {
          attempt,
          maxAttempts: finalConfig.maxAttempts,
          isRetryable,
        });
        throw lastError;
      }

      // Calculate delay and wait before next attempt
      const delayMs = calculateExponentialBackoff(
        attempt,
        finalConfig.baseDelayMs,
        finalConfig.maxDelayMs
      );

      logger.info('Retrying after delay', {
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
      });

      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed with unknown error');
}

export interface RetryMetadata {
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
}

export function getRetryMetadata(attempt: number, config: Partial<RetryConfig> = {}): RetryMetadata {
  const finalConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  return {
    attempt,
    maxAttempts: finalConfig.maxAttempts,
    delayMs: attempt < finalConfig.maxAttempts 
      ? calculateExponentialBackoff(attempt, finalConfig.baseDelayMs, finalConfig.maxDelayMs)
      : undefined,
  };
}

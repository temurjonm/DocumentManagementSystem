import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { logger } from './logger';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const CONCURRENCY_TABLE = process.env.CONCURRENCY_TABLE || 'dms-tenant-concurrency';
const DEFAULT_CONCURRENCY_LIMIT = 10;

export class ConcurrencyLimitExceededError extends Error {
  constructor(
    message: string,
    public tenantId: string,
    public currentCount: number,
    public limit: number
  ) {
    super(message);
    this.name = 'ConcurrencyLimitExceededError';
  }
}

export interface ConcurrencyStatus {
  tenantId: string;
  currentCount: number;
  limit: number;
  available: number;
}

export async function getCurrentConcurrency(tenantId: string): Promise<ConcurrencyStatus> {
  try {
    const response = await dynamodb.send(
      new GetItemCommand({
        TableName: CONCURRENCY_TABLE,
        Key: {
          tenant_id: { S: tenantId },
        },
      })
    );

    const currentCount = response.Item?.current_count?.N
      ? parseInt(response.Item.current_count.N, 10)
      : 0;

    const limit = response.Item?.concurrency_limit?.N
      ? parseInt(response.Item.concurrency_limit.N, 10)
      : DEFAULT_CONCURRENCY_LIMIT;

    return {
      tenantId,
      currentCount,
      limit,
      available: Math.max(0, limit - currentCount),
    };
  } catch (error) {
    logger.error('Failed to get current concurrency', error as Error, { tenantId });
    throw error;
  }
}

export async function incrementConcurrency(
  tenantId: string,
  concurrencyLimit?: number
): Promise<ConcurrencyStatus> {
  const limit = concurrencyLimit || DEFAULT_CONCURRENCY_LIMIT;

  try {
    // Atomic increment with conditional check
    const response = await dynamodb.send(
      new UpdateItemCommand({
        TableName: CONCURRENCY_TABLE,
        Key: {
          tenant_id: { S: tenantId },
        },
        UpdateExpression:
          'SET current_count = if_not_exists(current_count, :zero) + :inc, ' +
          'concurrency_limit = if_not_exists(concurrency_limit, :limit), ' +
          'updated_at = :now',
        ConditionExpression:
          'attribute_not_exists(current_count) OR current_count < concurrency_limit',
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':inc': { N: '1' },
          ':limit': { N: limit.toString() },
          ':now': { S: new Date().toISOString() },
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    const currentCount = response.Attributes?.current_count?.N
      ? parseInt(response.Attributes.current_count.N, 10)
      : 1;

    const actualLimit = response.Attributes?.concurrency_limit?.N
      ? parseInt(response.Attributes.concurrency_limit.N, 10)
      : limit;

    logger.info('Concurrency incremented', {
      tenantId,
      currentCount,
      limit: actualLimit,
    });

    return {
      tenantId,
      currentCount,
      limit: actualLimit,
      available: Math.max(0, actualLimit - currentCount),
    };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Limit exceeded
      const status = await getCurrentConcurrency(tenantId);
      
      logger.warn('Concurrency limit exceeded', {
        tenantId,
        currentCount: status.currentCount,
        limit: status.limit,
      });

      throw new ConcurrencyLimitExceededError(
        `Tenant ${tenantId} has reached concurrency limit of ${status.limit}`,
        tenantId,
        status.currentCount,
        status.limit
      );
    }

    logger.error('Failed to increment concurrency', error as Error, { tenantId });
    throw error;
  }
}

export async function decrementConcurrency(tenantId: string): Promise<ConcurrencyStatus> {
  try {
    // Atomic decrement with floor at 0
    const response = await dynamodb.send(
      new UpdateItemCommand({
        TableName: CONCURRENCY_TABLE,
        Key: {
          tenant_id: { S: tenantId },
        },
        UpdateExpression:
          'SET current_count = if_not_exists(current_count, :zero) - :dec, ' +
          'updated_at = :now',
        ConditionExpression: 'current_count > :zero',
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':dec': { N: '1' },
          ':now': { S: new Date().toISOString() },
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    const currentCount = response.Attributes?.current_count?.N
      ? parseInt(response.Attributes.current_count.N, 10)
      : 0;

    const limit = response.Attributes?.concurrency_limit?.N
      ? parseInt(response.Attributes.concurrency_limit.N, 10)
      : DEFAULT_CONCURRENCY_LIMIT;

    logger.info('Concurrency decremented', {
      tenantId,
      currentCount,
      limit,
    });

    return {
      tenantId,
      currentCount,
      limit,
      available: Math.max(0, limit - currentCount),
    };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Already at 0, ignore
      logger.warn('Attempted to decrement concurrency at 0', { tenantId });
      return {
        tenantId,
        currentCount: 0,
        limit: DEFAULT_CONCURRENCY_LIMIT,
        available: DEFAULT_CONCURRENCY_LIMIT,
      };
    }

    logger.error('Failed to decrement concurrency', error as Error, { tenantId });
    throw error;
  }
}

export async function acquireConcurrencySlot(
  tenantId: string,
  concurrencyLimit?: number
): Promise<ConcurrencyStatus> {
  logger.info('Acquiring concurrency slot', { tenantId, concurrencyLimit });
  return incrementConcurrency(tenantId, concurrencyLimit);
}

export async function releaseConcurrencySlot(tenantId: string): Promise<ConcurrencyStatus> {
  logger.info('Releasing concurrency slot', { tenantId });
  return decrementConcurrency(tenantId);
}

export async function withConcurrencyControl<T>(
  tenantId: string,
  operation: () => Promise<T>,
  concurrencyLimit?: number
): Promise<T> {
  let acquired = false;

  try {
    // Acquire slot
    await acquireConcurrencySlot(tenantId, concurrencyLimit);
    acquired = true;

    // Execute operation
    const result = await operation();

    return result;
  } finally {
    // Always release slot if acquired
    if (acquired) {
      try {
        await releaseConcurrencySlot(tenantId);
      } catch (error) {
        logger.error('Failed to release concurrency slot', error as Error, { tenantId });
      }
    }
  }
}

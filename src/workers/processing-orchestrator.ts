import {
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  ConcurrencyLimitExceededError,
  ConcurrencyStatus,
} from '../shared/concurrency';
import { logger } from '../shared/logger';
import { query } from '../shared/db';

export interface ProcessingRequest {
  documentId: string;
  versionId: string;
  tenantId: string;
  jobType: string;
  concurrencyLimit?: number;
}

export interface ProcessingResponse {
  documentId: string;
  versionId: string;
  status: 'ACCEPTED' | 'QUEUED' | 'REJECTED';
  concurrencyStatus?: ConcurrencyStatus;
  reason?: string;
}

export async function enforceAndStartProcessing(
  request: ProcessingRequest
): Promise<ProcessingResponse> {
  const { documentId, versionId, tenantId, jobType, concurrencyLimit } = request;

  logger.setContext({ documentId, versionId, tenantId, jobType });
  logger.info('Enforcing concurrency limits before processing', {
    concurrencyLimit,
  });

  try {
    // Attempt to acquire concurrency slot
    const concurrencyStatus = await acquireConcurrencySlot(tenantId, concurrencyLimit);

    logger.info('Concurrency slot acquired', {
      currentCount: concurrencyStatus.currentCount,
      limit: concurrencyStatus.limit,
      available: concurrencyStatus.available,
    });

    // Update processing job status to RUNNING
    await query(
      `UPDATE processing_jobs
       SET status = 'RUNNING', started_at = NOW()
       WHERE document_id = $1 AND version_id = $2 AND job_type = $3`,
      [documentId, versionId, jobType]
    );

    logger.info('Processing started', { documentId, versionId, jobType });

    return {
      documentId,
      versionId,
      status: 'ACCEPTED',
      concurrencyStatus,
    };
  } catch (error) {
    if (error instanceof ConcurrencyLimitExceededError) {
      logger.warn('Concurrency limit exceeded, queueing task', {
        tenantId,
        currentCount: error.currentCount,
        limit: error.limit,
      });

      // Update processing job to remain PENDING (queued)
      await query(
        `UPDATE processing_jobs
         SET status = 'PENDING', attempts = attempts + 1
         WHERE document_id = $1 AND version_id = $2 AND job_type = $3`,
        [documentId, versionId, jobType]
      );

      return {
        documentId,
        versionId,
        status: 'QUEUED',
        reason: `Tenant concurrency limit reached (${error.limit}). Task will retry.`,
      };
    }

    logger.error('Failed to enforce concurrency limits', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

export async function completeProcessing(
  documentId: string,
  versionId: string,
  tenantId: string,
  jobType: string,
  success: boolean
): Promise<void> {
  logger.setContext({ documentId, versionId, tenantId, jobType });
  logger.info('Completing processing and releasing concurrency slot', { success });

  try {
    // Release concurrency slot
    const concurrencyStatus = await releaseConcurrencySlot(tenantId);

    logger.info('Concurrency slot released', {
      currentCount: concurrencyStatus.currentCount,
      limit: concurrencyStatus.limit,
      available: concurrencyStatus.available,
    });

    // Update processing job status
    const newStatus = success ? 'COMPLETED' : 'FAILED';
    await query(
      `UPDATE processing_jobs
       SET status = $1, completed_at = NOW()
       WHERE document_id = $2 AND version_id = $3 AND job_type = $4`,
      [newStatus, documentId, versionId, jobType]
    );

    logger.info('Processing completed', { status: newStatus });
  } catch (error) {
    logger.error('Failed to complete processing', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

export async function handleProcessingFailure(
  documentId: string,
  versionId: string,
  tenantId: string,
  jobType: string,
  error: Error
): Promise<void> {
  logger.setContext({ documentId, versionId, tenantId, jobType });
  logger.error('Handling processing failure', error);

  try {
    // Release concurrency slot
    await releaseConcurrencySlot(tenantId);

    // Update processing job with error
    await query(
      `UPDATE processing_jobs
       SET status = 'FAILED', 
           error_message = $1, 
           completed_at = NOW()
       WHERE document_id = $2 AND version_id = $3 AND job_type = $4`,
      [error.message, documentId, versionId, jobType]
    );

    logger.info('Processing failure handled');
  } catch (err) {
    logger.error('Failed to handle processing failure', err as Error);
    throw err;
  } finally {
    logger.clearContext();
  }
}

export interface ProcessingWrapper {
  documentId: string;
  versionId: string;
  tenantId: string;
  jobType: string;
  concurrencyLimit?: number;
}

export async function executeWithConcurrencyEnforcement<T>(
  wrapper: ProcessingWrapper,
  operation: () => Promise<T>
): Promise<T> {
  const { documentId, versionId, tenantId, jobType, concurrencyLimit } = wrapper;

  // Enforce concurrency limits
  const response = await enforceAndStartProcessing({
    documentId,
    versionId,
    tenantId,
    jobType,
    concurrencyLimit,
  });

  if (response.status === 'QUEUED') {
    throw new ConcurrencyLimitExceededError(
      response.reason || 'Concurrency limit exceeded',
      tenantId,
      response.concurrencyStatus?.currentCount || 0,
      response.concurrencyStatus?.limit || 0
    );
  }

  try {
    // Execute the operation
    const result = await operation();

    // Complete successfully
    await completeProcessing(documentId, versionId, tenantId, jobType, true);

    return result;
  } catch (error) {
    // Handle failure
    await handleProcessingFailure(documentId, versionId, tenantId, jobType, error as Error);
    throw error;
  }
}

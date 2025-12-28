import { logger } from './logger';
import { JobType } from '../types';

export type WorkerType = 'LAMBDA' | 'FARGATE';

export interface TaskRoutingDecision {
  workerType: WorkerType;
  estimatedDurationMs: number;
  reason: string;
}

export interface TaskMetadata {
  jobType: JobType;
  fileSizeBytes?: number;
  pageCount?: number;
  mimeType?: string;
}

// Timeout thresholds
export const LAMBDA_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const FARGATE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

// Estimation constants (in milliseconds per unit)
const THUMBNAIL_TIME_PER_MB = 2000; // 2 seconds per MB
const OCR_TIME_PER_PAGE = 5000; // 5 seconds per page
const PDF_SPLIT_TIME_PER_PAGE = 1000; // 1 second per page
const MALWARE_SCAN_TIME_PER_MB = 3000; // 3 seconds per MB

// Size thresholds for routing decisions
const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB
const LARGE_PAGE_COUNT_THRESHOLD = 100; // 100 pages

export function estimateTaskDuration(metadata: TaskMetadata): number {
  const { jobType, fileSizeBytes = 0, pageCount = 0 } = metadata;

  switch (jobType) {
    case 'THUMBNAIL':
      // Thumbnails are generally fast, but large images take longer
      const fileSizeMB = fileSizeBytes / (1024 * 1024);
      return Math.max(5000, fileSizeMB * THUMBNAIL_TIME_PER_MB); // Min 5 seconds

    case 'OCR':
      // OCR duration depends on page count
      return Math.max(10000, pageCount * OCR_TIME_PER_PAGE); // Min 10 seconds

    case 'PDF_SPLIT':
      // PDF splitting depends on page count
      return Math.max(5000, pageCount * PDF_SPLIT_TIME_PER_PAGE); // Min 5 seconds

    case 'MALWARE_SCAN':
      // Malware scanning depends on file size
      const scanSizeMB = fileSizeBytes / (1024 * 1024);
      return Math.max(10000, scanSizeMB * MALWARE_SCAN_TIME_PER_MB); // Min 10 seconds

    default:
      // Default conservative estimate
      return 5 * 60 * 1000; // 5 minutes
  }
}

export function routeTask(metadata: TaskMetadata): TaskRoutingDecision {
  const estimatedDurationMs = estimateTaskDuration(metadata);
  const { jobType, fileSizeBytes = 0, pageCount = 0 } = metadata;

  // Decision logic
  let workerType: WorkerType;
  let reason: string;

  // Rule 1: Tasks estimated under 15 minutes go to Lambda
  if (estimatedDurationMs < LAMBDA_TIMEOUT_MS) {
    workerType = 'LAMBDA';
    reason = `Estimated duration ${Math.round(estimatedDurationMs / 1000)}s is under Lambda timeout`;
  } else {
    workerType = 'FARGATE';
    reason = `Estimated duration ${Math.round(estimatedDurationMs / 1000)}s exceeds Lambda timeout`;
  }

  // Rule 2: Override for large files - always use Fargate
  if (fileSizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
    workerType = 'FARGATE';
    reason = `Large file size ${Math.round(fileSizeBytes / (1024 * 1024))}MB requires Fargate`;
  }

  // Rule 3: Override for large page counts - always use Fargate
  if (pageCount > LARGE_PAGE_COUNT_THRESHOLD) {
    workerType = 'FARGATE';
    reason = `Large page count ${pageCount} requires Fargate`;
  }

  // Rule 4: Malware scanning always uses Fargate (runs in containers with ClamAV)
  if (jobType === 'MALWARE_SCAN') {
    workerType = 'FARGATE';
    reason = 'Malware scanning requires Fargate with ClamAV container';
  }

  logger.info('Task routing decision', {
    jobType,
    workerType,
    estimatedDurationMs,
    fileSizeBytes,
    pageCount,
    reason,
  });

  return {
    workerType,
    estimatedDurationMs,
    reason,
  };
}

export function getWorkerTimeout(workerType: WorkerType): number {
  return workerType === 'LAMBDA' ? LAMBDA_TIMEOUT_MS : FARGATE_TIMEOUT_MS;
}

export function shouldUseWorkerType(
  preferredWorkerType: WorkerType,
  metadata: TaskMetadata
): boolean {
  const decision = routeTask(metadata);
  return decision.workerType === preferredWorkerType;
}

import { query } from '../shared/db';
import { logger } from '../shared/logger';

interface CheckVersionEvent {
  documentId: string;
  versionId: string;
}

interface CheckVersionResult extends CheckVersionEvent {
  isLatest: boolean;
}

export async function handler(event: CheckVersionEvent): Promise<CheckVersionResult> {
  const { documentId, versionId } = event;
  
  logger.info('Checking if version is latest', { documentId, versionId });

  try {
    const result = await query<{ version_id: string }>(
      `SELECT id as version_id
       FROM document_versions
       WHERE document_id = $1
       ORDER BY version_number DESC
       LIMIT 1`,
      [documentId]
    );

    const isLatest = result.length > 0 && result[0].version_id === versionId;

    logger.info('Version check complete', { documentId, versionId, isLatest });

    return {
      ...event,
      isLatest
    };
  } catch (error) {
    logger.error('Failed to check version', error as Error, { documentId, versionId });
    throw error;
  }
}

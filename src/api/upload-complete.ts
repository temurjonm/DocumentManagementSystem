import { S3Event } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { query } from '../shared/db';
import { logger } from '../shared/logger';

const sfn = new SFNClient({ region: process.env.AWS_REGION });
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    logger.setContext({ s3Key });
    logger.info('Processing S3 upload event');

    const keyParts = s3Key.split('/');
    if (keyParts.length < 4) {
      logger.warn('Invalid S3 key format', { s3Key });
      continue;
    }

    const tenantId = keyParts[0];
    const documentId = keyParts[2];
    const versionId = keyParts[3];

    logger.setContext({ tenantId, documentId });

    try {
      await query(
        `UPDATE documents 
         SET status = 'UPLOADED', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'UPLOADING'`,
        [documentId, tenantId]
      );

      const versionResult = await query<{ version_id: string }>(
        `SELECT id as version_id FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [documentId]
      );

      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: STATE_MACHINE_ARN,
          input: JSON.stringify({
            documentId,
            versionId: versionResult[0]?.version_id || versionId,
            tenantId,
            s3Key,
            s3Bucket: record.s3.bucket.name,
          }),
        })
      );

      logger.info('Upload completed and processing triggered');
    } catch (error) {
      logger.error('Failed to process upload completion', error as Error);
      throw error;
    } finally {
      logger.clearContext();
    }
  }
}

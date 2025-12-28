import { SQSEvent, SQSRecord } from 'aws-lambda';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { query, queryOne, withTransaction } from '../shared/db';
import { logger } from '../shared/logger';
import { Document, DocumentVersion } from '../types';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.S3_BUCKET_NAME || '';

interface HardDeleteMessage {
  documentId: string;
  tenantId: string;
}

export async function handler(event: SQSEvent): Promise<void> {
  logger.info('Processing hard delete batch', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    try {
      await processMessage(record);
    } catch (error) {
      logger.error('Failed to process hard delete message', error as Error, {
        messageId: record.messageId,
      });
      throw error;
    }
  }
}

export async function processMessage(record: SQSRecord): Promise<void> {
  const message: HardDeleteMessage = JSON.parse(record.body);
  const { documentId, tenantId } = message;

  logger.setContext({ documentId, tenantId });

  try {
    logger.info('Starting hard delete', { documentId, tenantId });

    const document = await queryOne<Document>(
      `SELECT id, tenant_id, name, status
       FROM documents
       WHERE id = $1 AND tenant_id = $2`,
      [documentId, tenantId]
    );

    if (!document) {
      logger.warn('Document not found for hard delete', { documentId, tenantId });
      return;
    }

    if (document.status !== 'DELETING') {
      logger.warn('Document not in DELETING status', {
        documentId,
        status: document.status,
      });
      return;
    }

    const versions = await query<DocumentVersion>(
      `SELECT id, s3_key, s3_bucket
       FROM document_versions
       WHERE document_id = $1`,
      [documentId]
    );

    logger.info('Found document versions', {
      documentId,
      versionCount: versions.length,
    });

    await deleteS3Objects(tenantId, documentId);

    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM processing_jobs WHERE document_id = $1`,
        [documentId]
      );

      await client.query(
        `DELETE FROM document_versions WHERE document_id = $1`,
        [documentId]
      );

      await client.query(`DELETE FROM documents WHERE id = $1`, [documentId]);
    });

    logger.info('Hard delete completed', { documentId, tenantId });
  } catch (error) {
    logger.error('Hard delete failed', error as Error, {
      documentId,
      tenantId,
    });
    throw error;
  } finally {
    logger.clearContext();
  }
}

async function deleteS3Objects(
  tenantId: string,
  documentId: string
): Promise<void> {
  const prefix = `${tenantId}/documents/${documentId}/`;
  const derivedPrefix = `${tenantId}/derived/${documentId}/`;

  await deleteObjectsWithPrefix(prefix);
  await deleteObjectsWithPrefix(derivedPrefix);
}

async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const listResponse = await s3Client.send(listCommand);

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const objectsToDelete = listResponse.Contents.map((obj) => ({
        Key: obj.Key!,
      }));

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
          Quiet: true,
        },
      });

      await s3Client.send(deleteCommand);
      totalDeleted += objectsToDelete.length;

      logger.info('Deleted S3 objects', {
        prefix,
        count: objectsToDelete.length,
      });
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  logger.info('Completed S3 deletion for prefix', {
    prefix,
    totalDeleted,
  });
}

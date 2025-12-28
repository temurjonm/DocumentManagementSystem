import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger';

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function checkS3ObjectExists(
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // Re-throw other errors (permissions, network, etc.)
    throw error;
  }
}

export async function checkArtifactsExist(
  bucket: string,
  keys: string[]
): Promise<{ allExist: boolean; existingKeys: string[] }> {
  const existingKeys: string[] = [];

  for (const key of keys) {
    const exists = await checkS3ObjectExists(bucket, key);
    if (exists) {
      existingKeys.push(key);
    }
  }

  return {
    allExist: existingKeys.length === keys.length,
    existingKeys,
  };
}

export function logIdempotencyCheck(
  documentId: string,
  artifactType: string,
  exists: boolean
): void {
  if (exists) {
    logger.info('Artifacts already exist, skipping processing', {
      documentId,
      artifactType,
      idempotent: true,
    });
  } else {
    logger.info('Artifacts do not exist, proceeding with processing', {
      documentId,
      artifactType,
      idempotent: false,
    });
  }
}

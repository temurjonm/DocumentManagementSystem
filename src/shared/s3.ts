import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadUrl } from '../types';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.S3_BUCKET_NAME || '';
const URL_EXPIRATION = 900;

export function getS3Client(): S3Client {
  return s3Client;
}

export async function generateUploadUrl(
  tenantId: string,
  documentId: string,
  versionId: string,
  mimeType: string,
  sizeBytes: number,
  kmsKeyId: string
): Promise<UploadUrl> {
  const key = `${tenantId}/documents/${documentId}/${versionId}/original`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: kmsKeyId,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: URL_EXPIRATION,
  });

  return {
    url,
    expiresAt: new Date(Date.now() + URL_EXPIRATION * 1000),
  };
}

export async function generateDownloadUrl(
  tenantId: string,
  documentId: string,
  versionId: string
): Promise<UploadUrl> {
  const key = `${tenantId}/documents/${documentId}/${versionId}/original`;

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: URL_EXPIRATION,
  });

  return {
    url,
    expiresAt: new Date(Date.now() + URL_EXPIRATION * 1000),
  };
}

export function getKmsKeyForTenant(tenant: {
  kmsKeyArn?: string;
}): string {
  return tenant.kmsKeyArn || process.env.KMS_KEY_ID || '';
}

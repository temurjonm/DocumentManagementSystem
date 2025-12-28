import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import sharp from 'sharp';
import { logger } from '../shared/logger';
import { checkArtifactsExist, logIdempotencyCheck } from '../shared/idempotency';

const s3 = new S3Client({ region: process.env.AWS_REGION });

interface ThumbnailEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  s3Bucket: string;
  s3Key: string;
  sizes: number[];
  kmsKeyId?: string;
}

interface ThumbnailResult {
  documentId: string;
  versionId: string;
  thumbnails: Array<{
    size: number;
    s3Key: string;
  }>;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function downloadFile(bucket: string, key: string): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error('Empty S3 response body');
  }

  return streamToBuffer(response.Body as Readable);
}

async function generateThumbnail(
  imageBuffer: Buffer,
  size: number
): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(size, size, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function uploadThumbnail(
  bucket: string,
  key: string,
  buffer: Buffer,
  kmsKeyId?: string
): Promise<void> {
  const params: any = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  };

  if (kmsKeyId) {
    params.ServerSideEncryption = 'aws:kms';
    params.SSEKMSKeyId = kmsKeyId;
  }

  await s3.send(new PutObjectCommand(params));
}

export async function handler(event: ThumbnailEvent): Promise<ThumbnailResult> {
  const { documentId, versionId, tenantId, s3Bucket, s3Key, sizes, kmsKeyId } = event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Starting thumbnail generation', { s3Key, sizes });

  try {
    // Check if thumbnails already exist (idempotency)
    const expectedThumbnailKeys = sizes.map(
      (size) =>
        `${tenantId}/derived/${documentId}/${versionId}/thumbnails/${size}x${size}.jpg`
    );

    const { allExist, existingKeys } = await checkArtifactsExist(
      s3Bucket,
      expectedThumbnailKeys
    );

    if (allExist) {
      logIdempotencyCheck(documentId, 'thumbnails', true);
      
      // Return existing thumbnails without reprocessing
      return {
        documentId,
        versionId,
        thumbnails: sizes.map((size, index) => ({
          size,
          s3Key: expectedThumbnailKeys[index],
        })),
      };
    }

    logIdempotencyCheck(documentId, 'thumbnails', false);

    // Download the original image
    const imageBuffer = await downloadFile(s3Bucket, s3Key);
    logger.info('Downloaded source image', { sizeBytes: imageBuffer.length });

    // Generate thumbnails for each size
    const thumbnails: Array<{ size: number; s3Key: string }> = [];

    for (const size of sizes) {
      const thumbnailKey = `${tenantId}/derived/${documentId}/${versionId}/thumbnails/${size}x${size}.jpg`;

      // Skip if this specific thumbnail already exists
      if (existingKeys.includes(thumbnailKey)) {
        logger.info('Thumbnail already exists, skipping', { size, thumbnailKey });
        thumbnails.push({ size, s3Key: thumbnailKey });
        continue;
      }

      logger.info('Generating thumbnail', { size });

      const thumbnailBuffer = await generateThumbnail(imageBuffer, size);

      await uploadThumbnail(s3Bucket, thumbnailKey, thumbnailBuffer, kmsKeyId);

      logger.info('Uploaded thumbnail', {
        size,
        thumbnailKey,
        sizeBytes: thumbnailBuffer.length,
      });

      thumbnails.push({
        size,
        s3Key: thumbnailKey,
      });
    }

    logger.info('Thumbnail generation complete', {
      thumbnailCount: thumbnails.length,
    });

    return {
      documentId,
      versionId,
      thumbnails,
    };
  } catch (error) {
    logger.error('Thumbnail generation failed', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

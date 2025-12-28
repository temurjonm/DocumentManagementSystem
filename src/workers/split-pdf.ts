import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import { Readable } from 'stream';
import { logger } from '../shared/logger';
import { checkS3ObjectExists, logIdempotencyCheck } from '../shared/idempotency';

const s3 = new S3Client({ region: process.env.AWS_REGION });

interface SplitPdfEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  s3Bucket: string;
  s3Key: string;
  kmsKeyId?: string;
}

interface SplitPdfResult {
  documentId: string;
  versionId: string;
  pageCount: number;
  pages: Array<{
    pageNumber: number;
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

async function downloadPdf(bucket: string, key: string): Promise<Buffer> {
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

async function splitPdfIntoPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = pdfDoc.getPageCount();
  const pages: Buffer[] = [];

  logger.info('Splitting PDF', { pageCount });

  for (let i = 0; i < pageCount; i++) {
    // Create a new PDF document for this page
    const newPdf = await PDFDocument.create();
    
    // Copy the page from the original document
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);

    // Save the single-page PDF
    const pdfBytes = await newPdf.save();
    pages.push(Buffer.from(pdfBytes));

    logger.info('Split page', { pageNumber: i + 1 });
  }

  return pages;
}

async function uploadPage(
  bucket: string,
  key: string,
  buffer: Buffer,
  kmsKeyId?: string
): Promise<void> {
  const params: any = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
  };

  if (kmsKeyId) {
    params.ServerSideEncryption = 'aws:kms';
    params.SSEKMSKeyId = kmsKeyId;
  }

  await s3.send(new PutObjectCommand(params));
}

export async function handler(event: SplitPdfEvent): Promise<SplitPdfResult> {
  const { documentId, versionId, tenantId, s3Bucket, s3Key, kmsKeyId } = event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Starting PDF split', { s3Key });

  try {
    // Check if split pages already exist (idempotency)
    // We'll check for page-001.pdf as an indicator
    const firstPageKey = `${tenantId}/derived/${documentId}/${versionId}/split/page-001.pdf`;
    const firstPageExists = await checkS3ObjectExists(s3Bucket, firstPageKey);

    if (firstPageExists) {
      logIdempotencyCheck(documentId, 'pdf-split', true);
      
      // If first page exists, assume all pages exist
      // Download PDF to get page count for response
      const pdfBuffer = await downloadPdf(s3Bucket, s3Key);
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();

      const pages: Array<{ pageNumber: number; s3Key: string }> = [];
      for (let i = 1; i <= pageCount; i++) {
        pages.push({
          pageNumber: i,
          s3Key: `${tenantId}/derived/${documentId}/${versionId}/split/page-${String(
            i
          ).padStart(3, '0')}.pdf`,
        });
      }

      logger.info('PDF already split, returning existing pages', { pageCount });

      return {
        documentId,
        versionId,
        pageCount,
        pages,
      };
    }

    logIdempotencyCheck(documentId, 'pdf-split', false);

    // Download the PDF
    const pdfBuffer = await downloadPdf(s3Bucket, s3Key);
    logger.info('Downloaded PDF', { sizeBytes: pdfBuffer.length });

    // Split into individual pages
    const pageBuffers = await splitPdfIntoPages(pdfBuffer);
    const pageCount = pageBuffers.length;

    logger.info('PDF split complete', { pageCount });

    // Upload each page to S3
    const pages: Array<{ pageNumber: number; s3Key: string }> = [];

    for (let i = 0; i < pageBuffers.length; i++) {
      const pageNumber = i + 1;
      const pageBuffer = pageBuffers[i];

      // Construct S3 key for page
      // Pattern: {tenantId}/derived/{documentId}/{versionId}/split/page-{number}.pdf
      const pageKey = `${tenantId}/derived/${documentId}/${versionId}/split/page-${String(
        pageNumber
      ).padStart(3, '0')}.pdf`;

      await uploadPage(s3Bucket, pageKey, pageBuffer, kmsKeyId);

      logger.info('Uploaded page', {
        pageNumber,
        pageKey,
        sizeBytes: pageBuffer.length,
      });

      pages.push({
        pageNumber,
        s3Key: pageKey,
      });
    }

    logger.info('All pages uploaded', { pageCount: pages.length });

    return {
      documentId,
      versionId,
      pageCount,
      pages,
    };
  } catch (error) {
    logger.error('PDF split failed', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

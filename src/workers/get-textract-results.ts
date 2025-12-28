import {
  TextractClient,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
} from '@aws-sdk/client-textract';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../shared/logger';
import { checkS3ObjectExists, logIdempotencyCheck } from '../shared/idempotency';

const textract = new TextractClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

interface GetTextractResultsEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  jobId: string;
  s3Bucket: string;
  kmsKeyId?: string;
}

interface TextractResult {
  documentId: string;
  versionId: string;
  jobId: string;
  status: string;
  extractedText: string;
  s3Key: string;
  pageCount?: number;
}

async function getAllTextractResults(
  jobId: string
): Promise<GetDocumentTextDetectionCommandOutput[]> {
  const results: GetDocumentTextDetectionCommandOutput[] = [];
  let nextToken: string | undefined;

  do {
    const command = new GetDocumentTextDetectionCommand({
      JobId: jobId,
      NextToken: nextToken,
    });

    const response = await textract.send(command);
    results.push(response);

    nextToken = response.NextToken;
  } while (nextToken);

  return results;
}

function extractTextFromResults(
  results: GetDocumentTextDetectionCommandOutput[]
): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.Blocks) continue;

    for (const block of result.Blocks) {
      if (block.BlockType === 'LINE' && block.Text) {
        lines.push(block.Text);
      }
    }
  }

  return lines.join('\n');
}

async function storeExtractedText(
  bucket: string,
  key: string,
  text: string,
  metadata: any,
  kmsKeyId?: string
): Promise<void> {
  const params: any = {
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify({
      text,
      metadata,
      extractedAt: new Date().toISOString(),
    }),
    ContentType: 'application/json',
  };

  if (kmsKeyId) {
    params.ServerSideEncryption = 'aws:kms';
    params.SSEKMSKeyId = kmsKeyId;
  }

  await s3.send(new PutObjectCommand(params));
}

export async function handler(
  event: GetTextractResultsEvent
): Promise<TextractResult> {
  const { documentId, versionId, tenantId, jobId, s3Bucket, kmsKeyId } = event;

  logger.setContext({ documentId, versionId, tenantId, jobId });
  logger.info('Retrieving Textract results', { jobId });

  try {
    // Check if OCR results already exist (idempotency)
    const s3Key = `${tenantId}/derived/${documentId}/${versionId}/ocr/text.json`;
    const ocrExists = await checkS3ObjectExists(s3Bucket, s3Key);

    if (ocrExists) {
      logIdempotencyCheck(documentId, 'ocr', true);
      
      // Return existing OCR results without reprocessing
      // Note: We don't have the extracted text content, but the file exists
      logger.info('OCR results already exist', { s3Key });

      return {
        documentId,
        versionId,
        jobId,
        status: 'SUCCEEDED',
        extractedText: '', // Empty since we're not re-reading the file
        s3Key,
      };
    }

    logIdempotencyCheck(documentId, 'ocr', false);

    // Get all pages of results
    const results = await getAllTextractResults(jobId);

    if (results.length === 0) {
      throw new Error('No results returned from Textract');
    }

    const firstResult = results[0];
    const jobStatus = firstResult.JobStatus;

    logger.info('Textract job status', { jobStatus });

    if (jobStatus !== 'SUCCEEDED') {
      throw new Error(`Textract job failed with status: ${jobStatus}`);
    }

    // Extract text from all blocks
    const extractedText = extractTextFromResults(results);
    logger.info('Extracted text', {
      textLength: extractedText.length,
      pageCount: firstResult.DocumentMetadata?.Pages,
    });

    // Store extracted text in S3
    await storeExtractedText(
      s3Bucket,
      s3Key,
      extractedText,
      {
        documentId,
        versionId,
        jobId,
        pageCount: firstResult.DocumentMetadata?.Pages,
      },
      kmsKeyId
    );

    logger.info('Stored extracted text', { s3Key });

    return {
      documentId,
      versionId,
      jobId,
      status: jobStatus,
      extractedText,
      s3Key,
      pageCount: firstResult.DocumentMetadata?.Pages,
    };
  } catch (error) {
    logger.error('Failed to retrieve Textract results', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

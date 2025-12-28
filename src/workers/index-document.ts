import { logger } from '../shared/logger';
import { query } from '../shared/db';
import { indexDocument, DocumentIndexData } from '../shared/opensearch';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client } from '../shared/s3';

interface IndexDocumentEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  s3Bucket?: string;
  s3Key?: string;
}

interface DocumentData {
  id: string;
  tenant_id: string;
  name: string;
  owner_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface VersionData {
  id: string;
  version_number: number;
  s3_key: string;
  s3_bucket: string;
  size_bytes: number;
  mime_type: string;
}

export async function handler(event: IndexDocumentEvent): Promise<IndexDocumentEvent> {
  const { documentId, versionId, tenantId } = event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Starting document indexing');

  try {
    const documents = await query<DocumentData>(
      `SELECT id, tenant_id, name, owner_id, status, created_at, updated_at
       FROM documents
       WHERE id = $1 AND tenant_id = $2`,
      [documentId, tenantId]
    );

    if (!documents || documents.length === 0) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const document = documents[0];

    const versions = await query<VersionData>(
      `SELECT id, version_number, s3_key, s3_bucket, size_bytes, mime_type
       FROM document_versions
       WHERE id = $1 AND document_id = $2`,
      [versionId, documentId]
    );

    if (!versions || versions.length === 0) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const version = versions[0];

    let extractedText: string | undefined;

    try {
      const ocrKey = version.s3_key.replace('/original', '/ocr/text.json');
      const s3Client = getS3Client();

      const ocrResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: version.s3_bucket,
          Key: ocrKey,
        })
      );

      if (ocrResponse.Body) {
        const ocrData = await ocrResponse.Body.transformToString();
        const ocrJson = JSON.parse(ocrData);
        extractedText = ocrJson.text || ocrJson.extractedText;
      }
    } catch (error) {
      logger.info('No OCR text found for document', { documentId, versionId });
    }

    const indexData: DocumentIndexData = {
      document_id: document.id,
      tenant_id: document.tenant_id,
      name: document.name,
      owner_id: document.owner_id,
      mime_type: version.mime_type,
      status: document.status,
      extracted_text: extractedText,
      created_at: document.created_at.toISOString(),
      updated_at: document.updated_at.toISOString(),
      size_bytes: version.size_bytes,
      version_number: version.version_number,
    };

    await indexDocument(indexData);

    logger.info('Document indexed successfully', {
      documentId,
      versionId,
      hasExtractedText: !!extractedText,
    });

    return event;
  } catch (error) {
    logger.error('Failed to index document', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

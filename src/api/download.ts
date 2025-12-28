import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken } from '../shared/auth';
import { queryOne } from '../shared/db';
import { generateDownloadUrl } from '../shared/s3';
import { logger } from '../shared/logger';
import { createAuditLog, getClientIp } from '../shared/audit';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  InternalServerError,
} from '../shared/errors';
import { Document, DocumentVersion } from '../types';

interface DownloadResponse {
  downloadUrl: string;
  expiresAt: string;
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const requestId = event.requestContext.requestId;
  logger.setContext({ requestId });

  try {
    const token = extractToken(event.headers.authorization);
    const authContext = await validateToken(token);

    logger.setContext({
      userId: authContext.userId,
      tenantId: authContext.tenantId,
    });

    const documentId = event.pathParameters?.id;
    if (!documentId) {
      throw new NotFoundError('Document');
    }

    logger.setContext({ documentId });

    const document = await queryOne<Document>(
      `SELECT id, tenant_id, name, status 
       FROM documents 
       WHERE id = $1 AND status != $2`,
      [documentId, 'DELETED']
    );

    if (!document) {
      throw new NotFoundError('Document');
    }

    if (document.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot access document from different tenant');
    }

    if (document.status !== 'READY') {
      throw new ForbiddenError(
        `Document is not ready for download (status: ${document.status})`
      );
    }

    const version = await queryOne<DocumentVersion>(
      `SELECT id, s3_key, s3_bucket 
       FROM document_versions 
       WHERE document_id = $1 
       ORDER BY version_number DESC 
       LIMIT 1`,
      [documentId]
    );

    if (!version) {
      throw new NotFoundError('Document version');
    }

    const keyParts = version.s3Key.split('/');
    const tenantId = keyParts[0];
    const versionId = keyParts[3];

    const downloadUrl = await generateDownloadUrl(
      tenantId,
      documentId,
      versionId
    );

    logger.info('Download URL generated');

    await createAuditLog({
      tenantId: document.tenantId,
      userId: authContext.userId,
      action: 'DOWNLOAD',
      documentId,
      ipAddress: getClientIp(event.headers),
      metadata: {
        documentName: document.name,
      },
    });

    const response: DownloadResponse = {
      downloadUrl: downloadUrl.url,
      expiresAt: downloadUrl.expiresAt.toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('Request failed', { error: error.message, code: error.code });
      return {
        statusCode: error.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(error.toJSON()),
      };
    }

    logger.error('Unexpected error', error as Error);
    const internalError = new InternalServerError();
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(internalError.toJSON()),
    };
  } finally {
    logger.clearContext();
  }
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { logger } from '../shared/logger';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  InternalServerError,
} from '../shared/errors';
import { Document, DocumentVersion } from '../types';

interface DocumentResponse {
  id: string;
  tenantId: string;
  name: string;
  ownerId: string;
  status: string;
  legalHold: boolean;
  deletedAt?: string;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
  versions: Array<{
    id: string;
    versionNumber: number;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
    createdAt: string;
  }>;
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
      `SELECT id, tenant_id, name, owner_id, status, legal_hold, deleted_at, 
              retention_days, created_at, updated_at
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

    const versions = await query<DocumentVersion>(
      `SELECT id, version_number, size_bytes, mime_type, sha256, created_at
       FROM document_versions 
       WHERE document_id = $1 
       ORDER BY version_number DESC`,
      [documentId]
    );

    const response: DocumentResponse = {
      id: document.id,
      tenantId: document.tenantId,
      name: document.name,
      ownerId: document.ownerId,
      status: document.status,
      legalHold: document.legalHold,
      deletedAt: document.deletedAt?.toISOString(),
      retentionDays: document.retentionDays,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        sizeBytes: v.sizeBytes,
        mimeType: v.mimeType,
        sha256: v.sha256,
        createdAt: v.createdAt.toISOString(),
      })),
    };

    logger.info('Document metadata retrieved');

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

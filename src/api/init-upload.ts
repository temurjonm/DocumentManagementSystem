import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { validateToken, extractToken, hasUploadScope } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { generateUploadUrl, getKmsKeyForTenant } from '../shared/s3';
import { logger } from '../shared/logger';
import { createAuditLog, getClientIp } from '../shared/audit';
import {
  BadRequestError,
  ForbiddenError,
  AppError,
  InternalServerError,
} from '../shared/errors';
import { Tenant } from '../types';

interface InitUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tenantId?: string;
}

interface InitUploadResponse {
  documentId: string;
  uploadUrl: string;
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

    if (!hasUploadScope(authContext)) {
      throw new ForbiddenError('Token does not have upload permission');
    }

    logger.setContext({
      userId: authContext.userId,
      tenantId: authContext.tenantId,
    });

    if (!event.body) {
      throw new BadRequestError('Request body is required');
    }

    const body: InitUploadRequest = JSON.parse(event.body);

    if (!body.fileName || !body.mimeType || !body.sizeBytes) {
      throw new BadRequestError('fileName, mimeType, and sizeBytes are required');
    }

    if (body.sizeBytes <= 0) {
      throw new BadRequestError('sizeBytes must be positive');
    }

    const targetTenantId = body.tenantId || authContext.tenantId;

    if (targetTenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot upload to different tenant');
    }

    const tenant = await queryOne<Tenant>(
      'SELECT id, name, kms_key_arn FROM tenants WHERE id = $1',
      [targetTenantId]
    );

    if (!tenant) {
      throw new ForbiddenError('Tenant not found');
    }

    const documentId = uuidv4();
    const versionId = uuidv4();

    await query(
      `INSERT INTO documents (id, tenant_id, name, owner_id, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [documentId, targetTenantId, body.fileName, authContext.userId, 'UPLOADING']
    );

    await query(
      `INSERT INTO document_versions (id, document_id, version_number, s3_key, s3_bucket, sha256, size_bytes, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        versionId,
        documentId,
        1,
        `${targetTenantId}/documents/${documentId}/${versionId}/original`,
        process.env.S3_BUCKET_NAME || '',
        '',
        body.sizeBytes,
        body.mimeType,
      ]
    );

    const kmsKeyId = getKmsKeyForTenant(tenant);
    const uploadUrl = await generateUploadUrl(
      targetTenantId,
      documentId,
      versionId,
      body.mimeType,
      body.sizeBytes,
      kmsKeyId
    );

    logger.info('Upload initiated', { documentId });

    await createAuditLog({
      tenantId: targetTenantId,
      userId: authContext.userId,
      action: 'UPLOAD',
      documentId,
      ipAddress: getClientIp(event.headers),
      metadata: {
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
      },
    });

    const response: InitUploadResponse = {
      documentId,
      uploadUrl: uploadUrl.url,
      expiresAt: uploadUrl.expiresAt.toISOString(),
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

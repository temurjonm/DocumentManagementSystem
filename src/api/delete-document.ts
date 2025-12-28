import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { logger } from '../shared/logger';
import { createAuditLog, getClientIp } from '../shared/audit';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  InternalServerError,
  ConflictError,
} from '../shared/errors';
import { Document } from '../types';

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
      `SELECT id, tenant_id, name, owner_id, status, legal_hold, deleted_at
       FROM documents 
       WHERE id = $1`,
      [documentId]
    );

    if (!document) {
      throw new NotFoundError('Document');
    }

    if (document.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot delete document from different tenant');
    }

    if (document.legalHold) {
      throw new ConflictError('Cannot delete document with active legal hold');
    }

    if (document.status === 'DELETED' || document.status === 'DELETING') {
      throw new ConflictError('Document is already deleted or being deleted');
    }

    await query(
      `UPDATE documents 
       SET status = $1, deleted_at = $2, updated_at = NOW()
       WHERE id = $3`,
      ['DELETED', new Date(), documentId]
    );

    const ipAddress = getClientIp(event.headers);
    await createAuditLog({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      action: 'DELETE',
      documentId,
      ipAddress,
      metadata: {
        documentName: document.name,
        previousStatus: document.status,
      },
    });

    logger.info('Document soft deleted', {
      documentId,
      previousStatus: document.status,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'soft_deleted',
        documentId,
        deletedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('Delete request failed', { error: error.message, code: error.code });
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

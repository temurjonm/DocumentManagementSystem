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
  BadRequestError,
} from '../shared/errors';
import { Document } from '../types';

export async function setLegalHold(
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

    const body = JSON.parse(event.body || '{}');
    const { legalHold } = body;

    if (typeof legalHold !== 'boolean') {
      throw new BadRequestError('legalHold must be a boolean value');
    }

    const document = await queryOne<Document>(
      `SELECT id, tenant_id, name, status, legal_hold
       FROM documents 
       WHERE id = $1`,
      [documentId]
    );

    if (!document) {
      throw new NotFoundError('Document');
    }

    if (document.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot modify document from different tenant');
    }

    await query(
      `UPDATE documents 
       SET legal_hold = $1, updated_at = NOW()
       WHERE id = $2`,
      [legalHold, documentId]
    );

    const ipAddress = getClientIp(event.headers);
    await createAuditLog({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      action: legalHold ? 'LEGAL_HOLD_SET' : 'LEGAL_HOLD_REMOVED',
      documentId,
      ipAddress,
      metadata: {
        documentName: document.name,
        previousLegalHold: document.legalHold,
        newLegalHold: legalHold,
      },
    });

    logger.info('Legal hold updated', {
      documentId,
      legalHold,
      previousLegalHold: document.legalHold,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        documentId,
        legalHold,
        updatedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('Legal hold update failed', {
        error: error.message,
        code: error.code,
      });
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

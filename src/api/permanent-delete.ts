import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken, hasAdminRole } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { logger } from '../shared/logger';
import { createAuditLog, getClientIp } from '../shared/audit';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  InternalServerError,
  BadRequestError,
  ConflictError,
} from '../shared/errors';
import { Document } from '../types';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const HARD_DELETE_QUEUE_URL = process.env.HARD_DELETE_QUEUE_URL || '';

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

    if (!hasAdminRole(authContext)) {
      throw new ForbiddenError('Admin role required for permanent deletion');
    }

    const documentId = event.pathParameters?.id;
    if (!documentId) {
      throw new NotFoundError('Document');
    }

    logger.setContext({ documentId });

    const body = JSON.parse(event.body || '{}');
    const { confirm } = body;

    if (confirm !== true) {
      throw new BadRequestError(
        'Explicit confirmation required: set confirm to true'
      );
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
      throw new ForbiddenError('Cannot delete document from different tenant');
    }

    if (document.legalHold) {
      throw new ConflictError(
        'Cannot permanently delete document with active legal hold'
      );
    }

    if (document.status === 'DELETING') {
      throw new ConflictError('Document is already being deleted');
    }

    await query(
      `UPDATE documents 
       SET status = $1, deleted_at = $2, updated_at = NOW()
       WHERE id = $3`,
      ['DELETING', new Date(), documentId]
    );

    const sendMessageCommand = new SendMessageCommand({
      QueueUrl: HARD_DELETE_QUEUE_URL,
      MessageBody: JSON.stringify({
        documentId,
        tenantId: authContext.tenantId,
      }),
    });

    await sqsClient.send(sendMessageCommand);

    const ipAddress = getClientIp(event.headers);
    await createAuditLog({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      action: 'PERMANENT_DELETE',
      documentId,
      ipAddress,
      metadata: {
        documentName: document.name,
        previousStatus: document.status,
        bypassedRetention: true,
      },
    });

    logger.info('Permanent deletion initiated', {
      documentId,
      previousStatus: document.status,
      adminUser: authContext.userId,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'deleting',
        documentId,
        message: 'Permanent deletion initiated',
      }),
    };
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('Permanent delete request failed', {
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

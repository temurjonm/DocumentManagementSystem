import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken } from '../shared/auth';
import { query } from '../shared/db';
import { logger } from '../shared/logger';
import { BadRequestError, AppError, InternalServerError } from '../shared/errors';
import { Document } from '../types';

interface ListDocumentsResponse {
  documents: Array<{
    id: string;
    name: string;
    ownerId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
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

    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || '20', 10),
      100
    );
    const offset = parseInt(event.queryStringParameters?.offset || '0', 10);
    const status = event.queryStringParameters?.status;
    const ownerId = event.queryStringParameters?.ownerId;
    const fromDate = event.queryStringParameters?.fromDate;
    const toDate = event.queryStringParameters?.toDate;

    if (limit < 1 || offset < 0) {
      throw new BadRequestError('Invalid limit or offset');
    }

    const conditions: string[] = ['tenant_id = $1', 'status != $2'];
    const params: unknown[] = [authContext.tenantId, 'DELETED'];
    let paramIndex = 3;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (ownerId) {
      conditions.push(`owner_id = $${paramIndex}`);
      params.push(ownerId);
      paramIndex++;
    }

    if (fromDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(new Date(fromDate));
      paramIndex++;
    }

    if (toDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(new Date(toDate));
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const documents = await query<Document>(
      `SELECT id, name, owner_id, status, created_at, updated_at
       FROM documents 
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM documents WHERE ${whereClause}`,
      params
    );

    const total = parseInt(countResult[0]?.count || '0', 10);

    const response: ListDocumentsResponse = {
      documents: documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        ownerId: doc.ownerId,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };

    logger.info('Documents listed', { count: documents.length, total });

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

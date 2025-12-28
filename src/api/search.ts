import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { validateToken, extractToken } from '../shared/auth';
import { searchDocuments } from '../shared/opensearch';
import { logger } from '../shared/logger';
import { BadRequestError, AppError, InternalServerError } from '../shared/errors';

interface SearchResponse {
  results: Array<{
    id: string;
    name: string;
    ownerId: string;
    mimeType: string;
    status: string;
    extractedText?: string;
    createdAt: string;
    updatedAt: string;
    sizeBytes: number;
    versionNumber: number;
    tags?: string[];
  }>;
  total: number;
  limit: number;
  offset: number;
  query: string;
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

    const query = event.queryStringParameters?.q || event.queryStringParameters?.query;

    if (!query || query.trim().length === 0) {
      throw new BadRequestError('Query parameter "q" is required');
    }

    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || '20', 10),
      100
    );
    const offset = parseInt(event.queryStringParameters?.offset || '0', 10);

    if (limit < 1 || offset < 0) {
      throw new BadRequestError('Invalid limit or offset');
    }

    logger.info('Searching documents', { query, limit, offset });

    const searchResults = await searchDocuments(
      authContext.tenantId,
      query,
      limit,
      offset
    );

    const response: SearchResponse = {
      results: searchResults.results.map((doc) => ({
        id: doc.document_id,
        name: doc.name,
        ownerId: doc.owner_id,
        mimeType: doc.mime_type,
        status: doc.status,
        extractedText: doc.extracted_text,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        sizeBytes: doc.size_bytes,
        versionNumber: doc.version_number,
        tags: doc.tags,
      })),
      total: searchResults.total,
      limit,
      offset,
      query,
    };

    logger.info('Search completed', {
      resultCount: response.results.length,
      total: response.total,
    });

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
      logger.warn('Search request failed', {
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

    logger.error('Unexpected error during search', error as Error);
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

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { metrics } from './metrics';
import { logger } from './logger';

type ApiHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export function withMetrics(handler: ApiHandler): ApiHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();
    const endpoint = event.resource || event.path;
    const method = event.httpMethod;
    
    let tenantId: string | undefined;
    try {
      const claims = event.requestContext.authorizer?.claims;
      tenantId = claims?.tenant_id;
    } catch {
      // Tenant ID not available
    }

    let result: APIGatewayProxyResult;
    
    try {
      result = await handler(event);
    } catch (error) {
      logger.error('Unhandled error in API handler', error instanceof Error ? error : undefined, {
        endpoint,
        method,
        tenantId,
      });
      
      result = {
        statusCode: 500,
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        }),
      };
    }

    const latencyMs = Date.now() - startTime;
    const statusCode = result.statusCode;

    await Promise.all([
      metrics.recordApiLatency({
        endpoint,
        method,
        statusCode,
        latencyMs,
        tenantId,
      }),
      statusCode >= 400
        ? metrics.recordApiError({
            endpoint,
            method,
            statusCode,
            latencyMs,
            tenantId,
          })
        : Promise.resolve(),
    ]);

    return result;
  };
}

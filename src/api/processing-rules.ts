import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { validateToken, extractToken } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { logger } from '../shared/logger';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  AppError,
  InternalServerError,
} from '../shared/errors';
import { ProcessingRules } from '../types';

export async function createRule(
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

    if (!event.body) {
      throw new BadRequestError('Request body is required');
    }

    const body = JSON.parse(event.body);

    if (!body.mimeTypePattern || !body.rules) {
      throw new BadRequestError('mimeTypePattern and rules are required');
    }

    const ruleId = uuidv4();

    await query(
      `INSERT INTO processing_rules (id, tenant_id, mime_type_pattern, rules)
       VALUES ($1, $2, $3, $4)`,
      [ruleId, authContext.tenantId, body.mimeTypePattern, JSON.stringify(body.rules)]
    );

    logger.info('Processing rule created', { ruleId });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ id: ruleId }),
    };
  } catch (error) {
    return handleError(error);
  } finally {
    logger.clearContext();
  }
}

export async function getRule(
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

    const ruleId = event.pathParameters?.id;
    if (!ruleId) {
      throw new NotFoundError('Processing rule');
    }

    const rule = await queryOne<ProcessingRules>(
      `SELECT id, tenant_id, mime_type_pattern, rules, created_at
       FROM processing_rules 
       WHERE id = $1`,
      [ruleId]
    );

    if (!rule) {
      throw new NotFoundError('Processing rule');
    }

    if (rule.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot access rule from different tenant');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        id: rule.id,
        mimeTypePattern: rule.mimeTypePattern,
        rules: rule.rules,
        createdAt: rule.createdAt.toISOString(),
      }),
    };
  } catch (error) {
    return handleError(error);
  } finally {
    logger.clearContext();
  }
}

export async function listRules(
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

    const rules = await query<ProcessingRules>(
      `SELECT id, mime_type_pattern, rules, created_at
       FROM processing_rules 
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [authContext.tenantId]
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        rules: rules.map((r) => ({
          id: r.id,
          mimeTypePattern: r.mimeTypePattern,
          rules: r.rules,
          createdAt: r.createdAt.toISOString(),
        })),
      }),
    };
  } catch (error) {
    return handleError(error);
  } finally {
    logger.clearContext();
  }
}

export async function updateRule(
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

    const ruleId = event.pathParameters?.id;
    if (!ruleId) {
      throw new NotFoundError('Processing rule');
    }

    if (!event.body) {
      throw new BadRequestError('Request body is required');
    }

    const body = JSON.parse(event.body);

    const existingRule = await queryOne<ProcessingRules>(
      'SELECT tenant_id FROM processing_rules WHERE id = $1',
      [ruleId]
    );

    if (!existingRule) {
      throw new NotFoundError('Processing rule');
    }

    if (existingRule.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot update rule from different tenant');
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (body.mimeTypePattern) {
      updates.push(`mime_type_pattern = $${paramIndex}`);
      params.push(body.mimeTypePattern);
      paramIndex++;
    }

    if (body.rules) {
      updates.push(`rules = $${paramIndex}`);
      params.push(JSON.stringify(body.rules));
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new BadRequestError('No fields to update');
    }

    params.push(ruleId);

    await query(
      `UPDATE processing_rules SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    logger.info('Processing rule updated', { ruleId });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    return handleError(error);
  } finally {
    logger.clearContext();
  }
}

export async function deleteRule(
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

    const ruleId = event.pathParameters?.id;
    if (!ruleId) {
      throw new NotFoundError('Processing rule');
    }

    const existingRule = await queryOne<ProcessingRules>(
      'SELECT tenant_id FROM processing_rules WHERE id = $1',
      [ruleId]
    );

    if (!existingRule) {
      throw new NotFoundError('Processing rule');
    }

    if (existingRule.tenantId !== authContext.tenantId) {
      throw new ForbiddenError('Cannot delete rule from different tenant');
    }

    await query('DELETE FROM processing_rules WHERE id = $1', [ruleId]);

    logger.info('Processing rule deleted', { ruleId });

    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
    };
  } catch (error) {
    return handleError(error);
  } finally {
    logger.clearContext();
  }
}

function handleError(error: unknown): APIGatewayProxyResult {
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
}

import { query } from './db';
import { logger } from './logger';
import { AuditAction } from '../types';

interface CreateAuditLogParams {
  tenantId: string;
  action: AuditAction;
  userId?: string;
  documentId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, document_id, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.tenantId,
        params.userId || null,
        params.action,
        params.documentId || null,
        params.ipAddress || null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );

    logger.info('Audit log created', {
      action: params.action,
      documentId: params.documentId,
    });
  } catch (error) {
    logger.error('Failed to create audit log', error as Error, {
      action: params.action,
      documentId: params.documentId,
    });
  }
}

export function getClientIp(headers: Record<string, string | undefined>): string | undefined {
  return (
    headers['X-Forwarded-For']?.split(',')[0]?.trim() ||
    headers['X-Real-IP'] ||
    headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    headers['x-real-ip']
  );
}

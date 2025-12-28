import { query } from '../shared/db';
import { logger } from '../shared/logger';
import { ProcessingRules } from '../types';

interface LoadRulesInput {
  tenantId: string;
  mimeType: string;
}

interface LoadRulesOutput {
  rules: {
    ocr?: boolean;
    thumbnail?: { sizes: number[] };
    pdfSplit?: boolean;
    malwareScan?: boolean;
  };
  matched: boolean;
}

export async function handler(input: LoadRulesInput): Promise<LoadRulesOutput> {
  logger.setContext({ tenantId: input.tenantId });

  try {
    logger.info('Loading processing rules', { mimeType: input.mimeType });

    const matchingRules = await query<ProcessingRules>(
      `SELECT rules 
       FROM processing_rules 
       WHERE tenant_id = $1 
       AND $2 ~ mime_type_pattern
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.tenantId, input.mimeType]
    );

    if (matchingRules.length === 0) {
      logger.info('No matching rules found, using defaults');
      return {
        rules: {
          malwareScan: true,
        },
        matched: false,
      };
    }

    const rule = matchingRules[0];
    logger.info('Processing rules loaded', { rules: rule.rules });

    return {
      rules: rule.rules,
      matched: true,
    };
  } catch (error) {
    logger.error('Failed to load processing rules', error as Error);
    return {
      rules: {
        malwareScan: true,
      },
      matched: false,
    };
  } finally {
    logger.clearContext();
  }
}

import {
  TextractClient,
  StartDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import { logger } from '../shared/logger';

const textract = new TextractClient({ region: process.env.AWS_REGION });

interface StartTextractEvent {
  documentId: string;
  versionId: string;
  tenantId: string;
  s3Bucket: string;
  s3Key: string;
  notificationChannel?: {
    snsTopicArn: string;
    roleArn: string;
  };
}

interface StartTextractResult {
  documentId: string;
  versionId: string;
  jobId: string;
}

export async function handler(
  event: StartTextractEvent
): Promise<StartTextractResult> {
  const { documentId, versionId, tenantId, s3Bucket, s3Key, notificationChannel } =
    event;

  logger.setContext({ documentId, versionId, tenantId });
  logger.info('Starting Textract OCR job', { s3Bucket, s3Key });

  try {
    const params: any = {
      DocumentLocation: {
        S3Object: {
          Bucket: s3Bucket,
          Name: s3Key,
        },
      },
      ClientRequestToken: `${documentId}-${versionId}`,
    };

    // Add SNS notification channel if provided for async callback
    if (notificationChannel) {
      params.NotificationChannel = {
        SNSTopicArn: notificationChannel.snsTopicArn,
        RoleArn: notificationChannel.roleArn,
      };
    }

    const command = new StartDocumentTextDetectionCommand(params);
    const response = await textract.send(command);

    if (!response.JobId) {
      throw new Error('Textract did not return a JobId');
    }

    logger.info('Textract job started', { jobId: response.JobId });

    return {
      documentId,
      versionId,
      jobId: response.JobId,
    };
  } catch (error) {
    logger.error('Failed to start Textract job', error as Error);
    throw error;
  } finally {
    logger.clearContext();
  }
}

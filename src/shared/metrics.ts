import { CloudWatchClient, PutMetricDataCommand, MetricDatum, StandardUnit } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NAMESPACE = 'DMS';

interface ApiMetricData {
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  tenantId?: string;
}

interface ProcessingMetricData {
  tenantId: string;
  taskType: string;
  status: 'success' | 'failure';
  durationMs?: number;
}

class Metrics {
  async recordApiLatency(data: ApiMetricData): Promise<void> {
    const dimensions = [
      { Name: 'Endpoint', Value: data.endpoint },
      { Name: 'Method', Value: data.method },
    ];

    if (data.tenantId) {
      dimensions.push({ Name: 'TenantId', Value: data.tenantId });
    }

    const metrics: MetricDatum[] = [
      {
        MetricName: 'ApiLatency',
        Value: data.latencyMs,
        Unit: StandardUnit.Milliseconds,
        Timestamp: new Date(),
        Dimensions: dimensions,
        StorageResolution: 1,
      },
    ];

    await this.putMetrics(metrics);
  }

  async recordApiError(data: ApiMetricData): Promise<void> {
    const dimensions = [
      { Name: 'Endpoint', Value: data.endpoint },
      { Name: 'Method', Value: data.method },
      { Name: 'StatusCode', Value: data.statusCode.toString() },
    ];

    if (data.tenantId) {
      dimensions.push({ Name: 'TenantId', Value: data.tenantId });
    }

    const is4xx = data.statusCode >= 400 && data.statusCode < 500;
    const is5xx = data.statusCode >= 500 && data.statusCode < 600;

    const metrics: MetricDatum[] = [];

    if (is4xx) {
      metrics.push({
        MetricName: 'Api4xxErrors',
        Value: 1,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: dimensions,
      });
    }

    if (is5xx) {
      metrics.push({
        MetricName: 'Api5xxErrors',
        Value: 1,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: dimensions,
      });
    }

    if (metrics.length > 0) {
      await this.putMetrics(metrics);
    }
  }

  async recordUploadSuccess(tenantId: string, success: boolean): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'UploadSuccess',
        Value: success ? 1 : 0,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'TenantId', Value: tenantId }],
      },
      {
        MetricName: 'UploadFailure',
        Value: success ? 0 : 1,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'TenantId', Value: tenantId }],
      },
    ];

    await this.putMetrics(metrics);
  }

  async recordProcessingMetrics(data: ProcessingMetricData): Promise<void> {
    const dimensions = [
      { Name: 'TenantId', Value: data.tenantId },
      { Name: 'TaskType', Value: data.taskType },
    ];

    const metrics: MetricDatum[] = [
      {
        MetricName: 'ProcessingSuccess',
        Value: data.status === 'success' ? 1 : 0,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: dimensions,
      },
      {
        MetricName: 'ProcessingFailure',
        Value: data.status === 'failure' ? 1 : 0,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: dimensions,
      },
    ];

    if (data.durationMs !== undefined) {
      metrics.push({
        MetricName: 'ProcessingDuration',
        Value: data.durationMs,
        Unit: StandardUnit.Milliseconds,
        Timestamp: new Date(),
        Dimensions: dimensions,
        StorageResolution: 1,
      });
    }

    await this.putMetrics(metrics);
  }

  async recordQueueDepth(queueName: string, depth: number): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'QueueDepth',
        Value: depth,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'QueueName', Value: queueName }],
      },
    ];

    await this.putMetrics(metrics);
  }

  async recordDLQCount(queueName: string, count: number): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'DLQCount',
        Value: count,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: [{ Name: 'QueueName', Value: queueName }],
      },
    ];

    await this.putMetrics(metrics);
  }

  private async putMetrics(metrics: MetricDatum[]): Promise<void> {
    if (metrics.length === 0) return;

    try {
      const command = new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: metrics,
      });

      await cloudwatch.send(command);
    } catch (error) {
      console.error('Failed to publish metrics to CloudWatch', {
        error: error instanceof Error ? error.message : String(error),
        metricsCount: metrics.length,
      });
    }
  }
}

export const metrics = new Metrics();

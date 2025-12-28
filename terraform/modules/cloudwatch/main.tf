resource "aws_sns_topic" "alarms" {
  name = "dms-${var.environment}-alarms"

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "dms-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "ApiLatency", { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
            ["...", { stat = "p99", label = "p99" }]
          ]
          period = 300
          stat   = "Average"
          region = data.aws_region.current.name
          title  = "API Latency (ms)"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "Api4xxErrors", { stat = "Sum", label = "4xx Errors" }],
            [".", "Api5xxErrors", { stat = "Sum", label = "5xx Errors" }]
          ]
          period = 300
          stat   = "Sum"
          region = data.aws_region.current.name
          title  = "API Error Rates"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "UploadSuccess", { stat = "Sum", label = "Success" }],
            [".", "UploadFailure", { stat = "Sum", label = "Failure" }]
          ]
          period = 300
          stat   = "Sum"
          region = data.aws_region.current.name
          title  = "Upload Success Rate"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "ProcessingDuration", { stat = "Average", label = "Average Duration" }],
            ["...", { stat = "p95", label = "p95 Duration" }]
          ]
          period = 300
          stat   = "Average"
          region = data.aws_region.current.name
          title  = "Processing Duration (ms)"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "ProcessingSuccess", { stat = "Sum", label = "Success" }],
            [".", "ProcessingFailure", { stat = "Sum", label = "Failure" }]
          ]
          period = 300
          stat   = "Sum"
          region = data.aws_region.current.name
          title  = "Processing Success Rate"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "QueueDepth", { stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = data.aws_region.current.name
          title  = "Queue Depth"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["DMS", "DLQCount", { stat = "Sum" }]
          ]
          period = 300
          stat   = "Sum"
          region = data.aws_region.current.name
          title  = "Dead Letter Queue Count"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      }
    ]
  })
}

# Alarm: DLQ Count > 0
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  for_each = toset(var.dlq_names)

  alarm_name          = "dms-${var.environment}-dlq-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DLQCount"
  namespace           = "DMS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when messages appear in DLQ ${each.key}"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    QueueName = each.key
  }

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# Alarm: API 5xx Error Rate
resource "aws_cloudwatch_metric_alarm" "api_5xx_errors" {
  alarm_name          = "dms-${var.environment}-api-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Api5xxErrors"
  namespace           = "DMS"
  period              = 60
  statistic           = "Sum"
  threshold           = var.api_5xx_threshold
  alarm_description   = "Alert when API 5xx error rate exceeds ${var.api_5xx_threshold} per minute"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  treat_missing_data  = "notBreaching"

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# Alarm: Processing Failure Rate
resource "aws_cloudwatch_metric_alarm" "processing_failure_rate" {
  alarm_name          = "dms-${var.environment}-processing-failure-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.processing_failure_threshold
  alarm_description   = "Alert when processing failure rate exceeds ${var.processing_failure_threshold}%"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "failure_rate"
    expression  = "(failures / (successes + failures)) * 100"
    label       = "Failure Rate (%)"
    return_data = true
  }

  metric_query {
    id = "failures"
    metric {
      metric_name = "ProcessingFailure"
      namespace   = "DMS"
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "successes"
    metric {
      metric_name = "ProcessingSuccess"
      namespace   = "DMS"
      period      = 300
      stat        = "Sum"
    }
  }

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# Alarm: API Latency p99 > 2 seconds
resource "aws_cloudwatch_metric_alarm" "api_latency_p99" {
  alarm_name          = "dms-${var.environment}-api-latency-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApiLatency"
  namespace           = "DMS"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 2000
  alarm_description   = "Alert when API p99 latency exceeds 2 seconds"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  treat_missing_data  = "notBreaching"

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

data "aws_region" "current" {}

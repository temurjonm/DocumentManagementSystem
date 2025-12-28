# IAM role for queue metrics collector Lambda
resource "aws_iam_role" "queue_metrics_collector" {
  name = "dms-${var.environment}-queue-metrics-collector"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# IAM policy for queue metrics collector
resource "aws_iam_role_policy" "queue_metrics_collector" {
  name = "queue-metrics-collector-policy"
  role = aws_iam_role.queue_metrics_collector.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:GetQueueAttributes"
        ]
        Resource = var.sqs_queue_arns
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "DMS"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Lambda function for queue metrics collection
resource "aws_lambda_function" "queue_metrics_collector" {
  filename         = var.lambda_zip_path
  function_name    = "dms-${var.environment}-queue-metrics-collector"
  role             = aws_iam_role.queue_metrics_collector.arn
  handler          = "workers/queue-metrics-collector.handler"
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 256

  environment {
    variables = merge(
      var.queue_urls,
      {
        AWS_REGION = data.aws_region.current.name
      }
    )
  }

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# CloudWatch Event Rule to trigger metrics collection every 5 minutes
resource "aws_cloudwatch_event_rule" "queue_metrics_schedule" {
  name                = "dms-${var.environment}-queue-metrics-schedule"
  description         = "Trigger queue metrics collection every 5 minutes"
  schedule_expression = "rate(5 minutes)"

  tags = {
    Environment = var.environment
    Service     = "DMS"
  }
}

# CloudWatch Event Target
resource "aws_cloudwatch_event_target" "queue_metrics_collector" {
  rule      = aws_cloudwatch_event_rule.queue_metrics_schedule.name
  target_id = "QueueMetricsCollector"
  arn       = aws_lambda_function.queue_metrics_collector.arn
}

# Lambda permission for CloudWatch Events
resource "aws_lambda_permission" "allow_cloudwatch" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.queue_metrics_collector.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.queue_metrics_schedule.arn
}

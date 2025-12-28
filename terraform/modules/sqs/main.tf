resource "aws_sqs_queue" "processing_dlq" {
  name                      = "${var.environment}-dms-processing-dlq"
  message_retention_seconds = 1209600 # 14 days
  
  tags = {
    Name        = "${var.environment}-dms-processing-dlq"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_sqs_queue" "malware_scan_queue" {
  name                       = "${var.environment}-dms-malware-scan"
  visibility_timeout_seconds = 3600 # 1 hour for Fargate tasks
  message_retention_seconds  = 1209600 # 14 days
  receive_wait_time_seconds  = 20 # Long polling
  
  # Dead letter queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.processing_dlq.arn
    maxReceiveCount     = 5 # 5 retries for Fargate tasks
  })
  
  tags = {
    Name        = "${var.environment}-dms-malware-scan"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_sqs_queue" "thumbnail_queue" {
  name                       = "${var.environment}-dms-thumbnail"
  visibility_timeout_seconds = 900 # 15 minutes for Lambda
  message_retention_seconds  = 1209600 # 14 days
  receive_wait_time_seconds  = 20 # Long polling
  
  # Dead letter queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.processing_dlq.arn
    maxReceiveCount     = 3 # 3 retries for Lambda tasks
  })
  
  tags = {
    Name        = "${var.environment}-dms-thumbnail"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_sqs_queue" "pdf_split_queue" {
  name                       = "${var.environment}-dms-pdf-split"
  visibility_timeout_seconds = 3600 # 1 hour for Fargate tasks
  message_retention_seconds  = 1209600 # 14 days
  receive_wait_time_seconds  = 20 # Long polling
  
  # Dead letter queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.processing_dlq.arn
    maxReceiveCount     = 5 # 5 retries for Fargate tasks
  })
  
  tags = {
    Name        = "${var.environment}-dms-pdf-split"
    Environment = var.environment
    Service     = "dms"
  }
}

# CloudWatch alarm for DLQ messages
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${var.environment}-dms-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when messages appear in DLQ"
  treat_missing_data  = "notBreaching"
  
  dimensions = {
    QueueName = aws_sqs_queue.processing_dlq.name
  }
  
  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  
  tags = {
    Name        = "${var.environment}-dms-dlq-alarm"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_dynamodb_table" "tenant_concurrency" {
  name           = "${var.environment}-dms-tenant-concurrency"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "tenant_id"

  attribute {
    name = "tenant_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = false
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = "${var.environment}-dms-tenant-concurrency"
    Environment = var.environment
    Service     = "dms"
  }
}

# CloudWatch alarm for high concurrency usage
resource "aws_cloudwatch_metric_alarm" "high_concurrency" {
  alarm_name          = "${var.environment}-dms-high-concurrency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ConsumedReadCapacityUnits"
  namespace           = "AWS/DynamoDB"
  period              = 300
  statistic           = "Sum"
  threshold           = 1000
  alarm_description   = "Alert when DynamoDB concurrency table has high read usage"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = aws_dynamodb_table.tenant_concurrency.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  tags = {
    Name        = "${var.environment}-dms-high-concurrency-alarm"
    Environment = var.environment
    Service     = "dms"
  }
}

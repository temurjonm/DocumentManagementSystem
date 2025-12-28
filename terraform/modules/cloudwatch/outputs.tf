output "sns_topic_arn" {
  description = "ARN of the SNS topic for alarms"
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_name" {
  description = "Name of the CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "alarm_arns" {
  description = "ARNs of all CloudWatch alarms"
  value = merge(
    { for k, v in aws_cloudwatch_metric_alarm.dlq_messages : k => v.arn },
    {
      api_5xx_errors           = aws_cloudwatch_metric_alarm.api_5xx_errors.arn
      processing_failure_rate  = aws_cloudwatch_metric_alarm.processing_failure_rate.arn
      api_latency_p99          = aws_cloudwatch_metric_alarm.api_latency_p99.arn
    }
  )
}

output "tenant_concurrency_table_name" {
  description = "Name of the tenant concurrency DynamoDB table"
  value       = aws_dynamodb_table.tenant_concurrency.name
}

output "tenant_concurrency_table_arn" {
  description = "ARN of the tenant concurrency DynamoDB table"
  value       = aws_dynamodb_table.tenant_concurrency.arn
}

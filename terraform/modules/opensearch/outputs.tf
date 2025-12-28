output "domain_name" {
  description = "OpenSearch domain name"
  value       = aws_opensearch_domain.dms.domain_name
}

output "domain_id" {
  description = "OpenSearch domain ID"
  value       = aws_opensearch_domain.dms.domain_id
}

output "domain_arn" {
  description = "OpenSearch domain ARN"
  value       = aws_opensearch_domain.dms.arn
}

output "endpoint" {
  description = "OpenSearch domain endpoint"
  value       = aws_opensearch_domain.dms.endpoint
}

output "kibana_endpoint" {
  description = "OpenSearch Dashboards endpoint"
  value       = aws_opensearch_domain.dms.dashboard_endpoint
}

output "security_group_id" {
  description = "Security group ID for OpenSearch cluster"
  value       = aws_security_group.opensearch.id
}

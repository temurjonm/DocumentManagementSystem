output "cluster_endpoint" {
  value = aws_rds_cluster.aurora.endpoint
}

output "cluster_id" {
  value = aws_rds_cluster.aurora.id
}

output "cluster_arn" {
  value = aws_rds_cluster.aurora.arn
}

output "db_secret_arn" {
  value = aws_secretsmanager_secret.db_password.arn
}

output "db_username" {
  value = aws_rds_cluster.aurora.master_username
}

output "db_password" {
  value     = random_password.db_password.result
  sensitive = true
}

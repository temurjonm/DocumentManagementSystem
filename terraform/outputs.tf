output "vpc_id" {
  value = module.vpc.vpc_id
}

output "aurora_endpoint" {
  value     = module.aurora.cluster_endpoint
  sensitive = true
}

output "s3_bucket_name" {
  value = module.s3.bucket_name
}

output "shared_kms_key_arn" {
  value = module.kms.shared_cmk_arn
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_web_client_id" {
  value = module.cognito.web_client_id
}

output "cognito_web_client_secret" {
  value     = module.cognito.web_client_secret
  sensitive = true
}

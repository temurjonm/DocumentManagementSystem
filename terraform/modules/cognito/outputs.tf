output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "web_client_secret" {
  value     = aws_cognito_user_pool_client.web.client_secret
  sensitive = true
}

output "agent_client_id" {
  value = aws_cognito_user_pool_client.agent.id
}

output "agent_client_secret" {
  value     = aws_cognito_user_pool_client.agent.client_secret
  sensitive = true
}

output "device_client_id" {
  value = aws_cognito_user_pool_client.device.id
}

output "domain" {
  value = aws_cognito_user_pool_domain.main.domain
}

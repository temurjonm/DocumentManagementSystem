output "api_endpoint" {
  value = aws_apigatewayv2_stage.main.invoke_url
}

output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "api_execution_arn" {
  value = aws_apigatewayv2_api.main.execution_arn
}

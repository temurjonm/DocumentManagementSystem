resource "aws_apigatewayv2_api" "main" {
  name          = "dms-api-${var.environment}"
  protocol_type = "HTTP"
  
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["*"]
    max_age       = 300
  }

  tags = {
    Name        = "dms-api-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  tags = {
    Name        = "dms-api-stage-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/dms-${var.environment}"
  retention_in_days = 7

  tags = {
    Name        = "dms-api-logs-${var.environment}"
    Environment = var.environment
  }
}

# Lambda integrations
resource "aws_apigatewayv2_integration" "init_upload" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.init_upload_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "init_upload" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/v1/documents/init-upload"
  target    = "integrations/${aws_apigatewayv2_integration.init_upload.id}"
}

resource "aws_apigatewayv2_integration" "list_documents" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.list_documents_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_documents" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/documents"
  target    = "integrations/${aws_apigatewayv2_integration.list_documents.id}"
}

resource "aws_apigatewayv2_integration" "get_document" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.get_document_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_document" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/documents/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.get_document.id}"
}

resource "aws_apigatewayv2_integration" "download" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.download_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "download" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/documents/{id}/download"
  target    = "integrations/${aws_apigatewayv2_integration.download.id}"
}

resource "aws_apigatewayv2_integration" "delete_document" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.delete_document_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "delete_document" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/v1/documents/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.delete_document.id}"
}

resource "aws_apigatewayv2_integration" "search" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.search_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "search" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/v1/documents/search"
  target    = "integrations/${aws_apigatewayv2_integration.search.id}"
}

# Cognito Authorizer
# Lambda permissions for API Gateway
resource "aws_lambda_permission" "init_upload" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.init_upload_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "list_documents" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.list_documents_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "get_document" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.get_document_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "download" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.download_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "delete_document" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.delete_document_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "search" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.search_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

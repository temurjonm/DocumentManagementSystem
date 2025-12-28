locals {
  lambda_package_path = "${path.root}/../lambda-package.zip"
  lambda_functions = {
    init-upload      = { handler = "dist/api/init-upload.handler", timeout = 30 }
    list-documents   = { handler = "dist/api/list-documents.handler", timeout = 30 }
    get-document     = { handler = "dist/api/get-document.handler", timeout = 30 }
    download         = { handler = "dist/api/download.handler", timeout = 30 }
    delete-document  = { handler = "dist/api/delete-document.handler", timeout = 30 }
    search           = { handler = "dist/api/search.handler", timeout = 30 }
  }
}

# Lambda Functions
resource "aws_lambda_function" "api" {
  for_each = local.lambda_functions

  filename         = local.lambda_package_path
  function_name    = "dms-${each.key}-${var.environment}"
  role            = var.lambda_role_arn
  handler         = each.value.handler
  source_code_hash = filebase64sha256(local.lambda_package_path)
  runtime         = "nodejs18.x"
  timeout         = each.value.timeout
  memory_size     = 512

  environment {
    variables = {
      DATABASE_URL          = var.database_url
      AWS_REGION_CUSTOM     = var.aws_region
      S3_BUCKET_NAME        = var.s3_bucket_name
      KMS_KEY_ID            = var.kms_key_id
      COGNITO_USER_POOL_ID  = var.cognito_user_pool_id
      COGNITO_CLIENT_ID     = var.cognito_client_id
      NODE_ENV              = var.environment
    }
  }

  # vpc_config {
  #   subnet_ids         = var.private_subnet_ids
  #   security_group_ids = [aws_security_group.lambda.id]
  # }

  tags = {
    Name        = "dms-${each.key}-${var.environment}"
    Environment = var.environment
  }
}

# Security Group for Lambda
resource "aws_security_group" "lambda" {
  name        = "dms-lambda-${var.environment}"
  description = "Security group for DMS Lambda functions"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "dms-lambda-sg-${var.environment}"
    Environment = var.environment
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/dms-${each.key}-${var.environment}"
  retention_in_days = 7

  tags = {
    Name        = "dms-${each.key}-logs-${var.environment}"
    Environment = var.environment
  }
}

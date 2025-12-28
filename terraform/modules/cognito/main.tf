resource "aws_cognito_user_pool" "main" {
  name = "dms-users-${var.environment}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = {
    Name        = "dms-user-pool-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "dms-web-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile", "dms/upload", "dms/read", "dms/delete"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_resource_server.main]
}

resource "aws_cognito_user_pool_client" "agent" {
  name         = "dms-agent-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = ["dms/upload"]

  access_token_validity = 1

  token_validity_units {
    access_token = "hours"
  }

  depends_on = [aws_cognito_resource_server.main]
}

resource "aws_cognito_user_pool_client" "device" {
  name         = "dms-device-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["dms/upload", "openid"]
  callback_urls                        = ["http://localhost:8080/callback"]

  explicit_auth_flows = [
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  enable_token_revocation = true
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_resource_server.main]
}

resource "aws_cognito_resource_server" "main" {
  identifier   = "dms"
  name         = "DMS API"
  user_pool_id = aws_cognito_user_pool.main.id

  scope {
    scope_name        = "upload"
    scope_description = "Upload documents"
  }

  scope {
    scope_name        = "read"
    scope_description = "Read documents"
  }

  scope {
    scope_name        = "delete"
    scope_description = "Delete documents"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "dms-${var.environment}-${random_string.domain_suffix.result}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "random_string" "domain_suffix" {
  length  = 8
  special = false
  upper   = false
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "lambda_role_arn" {
  type = string
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "s3_bucket_name" {
  type = string
}

variable "kms_key_id" {
  type = string
}

variable "cognito_user_pool_id" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

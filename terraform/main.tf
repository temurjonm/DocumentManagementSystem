terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "vpc" {
  source = "./modules/vpc"
  
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "kms" {
  source = "./modules/kms"
  
  environment = var.environment
}

module "s3" {
  source = "./modules/s3"
  
  environment        = var.environment
  kms_key_arn       = module.kms.shared_cmk_arn
  bucket_name_prefix = var.bucket_name_prefix
}

module "aurora" {
  source = "./modules/aurora"
  
  environment         = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids
  kms_key_arn        = module.kms.shared_cmk_arn
}

module "iam" {
  source = "./modules/iam"
  
  environment         = var.environment
  aurora_cluster_arn  = module.aurora.cluster_arn
  s3_bucket_arn       = module.s3.bucket_arn
  kms_key_arn         = module.kms.shared_cmk_arn
  db_secret_arn       = module.aurora.db_secret_arn
}

module "cognito" {
  source = "./modules/cognito"
  
  environment   = var.environment
  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls
}

module "lambda" {
  source = "./modules/lambda"
  
  environment                = var.environment
  aws_region                 = var.aws_region
  vpc_id                     = module.vpc.vpc_id
  private_subnet_ids         = module.vpc.private_subnet_ids
  lambda_role_arn            = module.iam.api_lambda_role_arn
  database_url               = "postgresql://${module.aurora.db_username}:${module.aurora.db_password}@${module.aurora.cluster_endpoint}:5432/dms"
  s3_bucket_name             = module.s3.bucket_name
  kms_key_id                 = module.kms.shared_cmk_key_id
  cognito_user_pool_id       = module.cognito.user_pool_id
  cognito_client_id          = module.cognito.web_client_id
}

module "api_gateway" {
  source = "./modules/api-gateway"
  
  environment                  = var.environment
  aws_region                   = var.aws_region
  init_upload_lambda_arn       = module.lambda.init_upload_arn
  init_upload_lambda_name      = module.lambda.init_upload_name
  list_documents_lambda_arn    = module.lambda.list_documents_arn
  list_documents_lambda_name   = module.lambda.list_documents_name
  get_document_lambda_arn      = module.lambda.get_document_arn
  get_document_lambda_name     = module.lambda.get_document_name
  download_lambda_arn          = module.lambda.download_arn
  download_lambda_name         = module.lambda.download_name
  delete_document_lambda_arn   = module.lambda.delete_document_arn
  delete_document_lambda_name  = module.lambda.delete_document_name
  search_lambda_arn            = module.lambda.search_arn
  search_lambda_name           = module.lambda.search_name
}

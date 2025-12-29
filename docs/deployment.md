# Deployment Guide

How to deploy the Document Management System to AWS.

## Prerequisites

Required tools:
- Terraform 1.6+
- Node.js 18+
- AWS CLI 2.x
- PostgreSQL client 14+ (for migrations)

AWS permissions needed:
- VPC, S3, RDS Aurora, Lambda, API Gateway
- Step Functions, SQS, CloudWatch
- KMS, Cognito, OpenSearch, ECS

## Quick Start

### 1. Install dependencies

```bash
npm install
cd terraform
terraform init
```

### 2. Configure variables

Create `terraform/terraform.tfvars`:

```hcl
environment         = "dev"
aws_region         = "us-east-1"
vpc_cidr           = "10.0.0.0/16"
bucket_name_prefix = "dms-documents"

cognito_callback_urls = [
  "http://localhost:3000/api/auth/callback/cognito"
]

cognito_logout_urls = [
  "http://localhost:3000"
]
```

### 3. Deploy infrastructure

```bash
terraform plan
terraform apply
```

This creates:
- VPC with public/private subnets
- Aurora PostgreSQL cluster
- S3 bucket with encryption
- Cognito user pool
- Lambda functions
- API Gateway
- KMS encryption keys

### 4. Run database migrations

```bash
# Get database endpoint from Terraform output
export DATABASE_URL=$(terraform output -raw database_url)

# Run migrations
npm run migrate:up
```

### 5. Build and deploy Lambda code

```bash
npm run build
npm run package:lambda

# Deploy each Lambda function
cd terraform
terraform apply
```

### 6. Verify deployment

```bash
# Check API Gateway
curl https://$(terraform output -raw api_gateway_url)/health

# Check Cognito
aws cognito-idp describe-user-pool \
  --user-pool-id $(terraform output -raw cognito_user_pool_id)
```

## Deploy to Production

For production deployments, configure remote state:

```hcl
# terraform/backend.tf
terraform {
  backend "s3" {
    bucket         = "dms-terraform-state-prod"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "dms-terraform-locks"
  }
}
```

Create the state bucket:

```bash
aws s3 mb s3://dms-terraform-state-prod
aws s3api put-bucket-versioning \
  --bucket dms-terraform-state-prod \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name dms-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## Post-Deployment Setup

### Create test user

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <user-pool-id> \
  --username testuser@example.com \
  --user-attributes Name=email,Value=testuser@example.com \
  --temporary-password TempPass123! \
  --message-action SUPPRESS
```

### Create test tenant

```bash
psql $DATABASE_URL -c "
INSERT INTO tenants (id, name, plan, storage_quota_gb, retention_days)
VALUES (
  gen_random_uuid(),
  'Test Tenant',
  'pro',
  100,
  90
);
"
```

## Rollback

To rollback a deployment:

```bash
# Revert to previous Terraform state
terraform state pull > current-state.json
terraform state push previous-state.json

# Or destroy and recreate specific resources
terraform destroy -target=module.lambda
terraform apply
```

To rollback Lambda code:

```bash
# List versions
aws lambda list-versions-by-function --function-name dms-init-upload-dev

# Update alias to previous version
aws lambda update-alias \
  --function-name dms-init-upload-dev \
  --name production \
  --function-version 2
```

## Troubleshooting

### Lambda can't connect to database

Check VPC configuration:
```bash
aws lambda get-function-configuration --function-name dms-init-upload-dev \
  --query 'VpcConfig'
```

Lambda must be in same VPC as Aurora. Fix in `terraform/modules/lambda/main.tf`:

```hcl
vpc_config {
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.lambda.id]
}
```

### API Gateway returns 403

Check authorization configuration:
```bash
aws apigatewayv2 get-route --api-id <api-id> --route-id <route-id>
```

Ensure JWT authorizer is configured correctly.

### Terraform state locked

If deployment fails mid-apply:

```bash
# Force unlock (use with caution)
terraform force-unlock <lock-id>
```

### Database migration fails

Check connection:
```bash
psql $DATABASE_URL -c "SELECT version();"
```

If connection fails, check security group rules and Aurora endpoint.

## Environment Variables

Lambda functions need these environment variables (set via Terraform):

```hcl
environment_variables = {
  DATABASE_URL          = var.database_url
  AWS_REGION           = var.aws_region
  S3_BUCKET_NAME       = var.s3_bucket_name
  KMS_KEY_ID           = var.kms_key_id
  COGNITO_USER_POOL_ID = var.cognito_user_pool_id
  COGNITO_CLIENT_ID    = var.cognito_client_id
}
```

Never hardcode credentials. Use AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name dms/database/password \
  --secret-string "your-secure-password"
```

## Cost Estimate

Monthly AWS costs (development environment):

- Aurora Serverless v2: $40-100
- Lambda: $20-50
- S3: $10-50
- API Gateway: $3-10
- CloudWatch: $10-30
- Total: ~$100-250/month

Production costs will be higher based on usage.

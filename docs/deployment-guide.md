# Document Management System - Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Infrastructure Deployment](#infrastructure-deployment)
4. [Database Migration](#database-migration)
5. [Application Deployment](#application-deployment)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

- **Terraform**: >= 1.6.0
- **Node.js**: >= 18.x
- **npm**: >= 9.x
- **AWS CLI**: >= 2.x
- **PostgreSQL Client**: >= 14.x (for migrations)

### AWS Account Requirements

- AWS account with appropriate permissions
- IAM user or role with permissions for:
  - VPC, EC2, S3, RDS Aurora, Lambda, API Gateway
  - Step Functions, SQS, EventBridge, CloudWatch
  - KMS, Cognito, OpenSearch, ECS Fargate
  - IAM role and policy management

### Access Requirements

- AWS credentials configured (`aws configure` or environment variables)
- S3 bucket for Terraform state (recommended for production)
- Domain name for API (optional, can use API Gateway default)

## Environment Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd dms-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create environment-specific configuration files:

```bash
# Development
cp .env.example .env.dev

# Staging
cp .env.example .env.staging

# Production
cp .env.example .env.prod
```

Edit each file with appropriate values:

```bash
# .env.dev
DATABASE_URL=postgresql://dms_admin:password@<aurora-endpoint>:5432/dms
AWS_REGION=us-east-1
S3_BUCKET_NAME=dms-documents-dev
KMS_KEY_ID=<kms-key-id>
COGNITO_USER_POOL_ID=<user-pool-id>
COGNITO_CLIENT_ID=<client-id>
OPENSEARCH_ENDPOINT=<opensearch-endpoint>
STEP_FUNCTIONS_ARN=<state-machine-arn>
```

### 4. Configure Terraform Backend (Production)

For production deployments, configure remote state storage:

```bash
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

Create the S3 bucket and DynamoDB table:

```bash
aws s3 mb s3://dms-terraform-state-prod --region us-east-1
aws s3api put-bucket-versioning \
  --bucket dms-terraform-state-prod \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name dms-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

## Infrastructure Deployment

### 1. Initialize Terraform

```bash
cd terraform
terraform init
```

### 2. Create Terraform Variables File

Create `terraform.tfvars` for your environment:

```hcl
# terraform/terraform.tfvars
environment         = "dev"
aws_region         = "us-east-1"
vpc_cidr           = "10.0.0.0/16"
bucket_name_prefix = "dms-documents"

cognito_callback_urls = [
  "https://app.example.com/api/auth/callback/cognito",
  "http://localhost:3000/api/auth/callback/cognito"
]

cognito_logout_urls = [
  "https://app.example.com",
  "http://localhost:3000"
]
```

### 3. Plan Infrastructure Changes

Review the planned changes before applying:

```bash
terraform plan -out=tfplan
```

Review the output carefully, ensuring:
- Correct resource counts
- Appropriate resource configurations
- No unexpected deletions or replacements

### 4. Apply Infrastructure

```bash
terraform apply tfplan
```

This will create:
- VPC with public and private subnets
- Aurora Serverless v2 PostgreSQL cluster
- S3 bucket with KMS encryption
- KMS keys (shared CMK and per-tenant keys)
- Cognito user pool
- IAM roles and policies
- OpenSearch cluster
- SQS queues and DLQs
- Step Functions state machine
- Lambda functions
- ECS Fargate task definitions
- CloudWatch log groups and alarms
- EventBridge rules

**Deployment time**: Approximately 20-30 minutes

### 5. Capture Outputs

Save Terraform outputs for later use:

```bash
terraform output -json > ../terraform-outputs.json
```

Key outputs include:
- `aurora_endpoint`: Database connection endpoint
- `s3_bucket_name`: Document storage bucket
- `kms_key_id`: Shared KMS key ID
- `cognito_user_pool_id`: User pool ID
- `cognito_client_id`: App client ID
- `opensearch_endpoint`: OpenSearch cluster endpoint
- `api_gateway_url`: API Gateway endpoint
- `step_functions_arn`: Processing state machine ARN

## Database Migration

### 1. Configure Database Connection

Set the database URL from Terraform outputs:

```bash
export DATABASE_URL=$(terraform output -raw aurora_endpoint | \
  sed 's/^/postgresql:\/\/dms_admin:PASSWORD@/' | \
  sed 's/$/:5432\/dms/')
```

Replace `PASSWORD` with the actual password from AWS Secrets Manager:

```bash
aws secretsmanager get-secret-value \
  --secret-id dms-db-credentials-dev \
  --query SecretString \
  --output text | jq -r .password
```

### 2. Run Database Migrations

```bash
cd ..
npm run migrate:up
```

This will create:
- `tenants` table
- `documents` table with row-level security
- `document_versions` table
- `processing_jobs` table
- `processing_rules` table
- `audit_logs` table with immutability constraints
- All required indexes
- Row-level security policies

### 3. Verify Migration

```bash
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "\di"
```

Expected tables:
- tenants
- documents
- document_versions
- processing_jobs
- processing_rules
- audit_logs
- pgmigrations (migration tracking)

### 4. Create Initial Tenant (Optional)

For testing, create an initial tenant:

```bash
psql $DATABASE_URL << EOF
INSERT INTO tenants (id, name, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Tenant',
  NOW()
);
EOF
```

## Application Deployment

### 1. Build Application

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 2. Package Lambda Functions

Each Lambda function needs to be packaged with dependencies:

```bash
# Build production Lambda package (includes node_modules)
npm run build
bash scripts/package-lambda.sh
```

### 3. Deploy Lambda Functions

Update Lambda function code:

```bash
# Get Lambda function names from Terraform outputs
FUNCTIONS=$(terraform output -json lambda_function_names | jq -r '.[]')

for func in $FUNCTIONS; do
  aws lambda update-function-code \
    --function-name $func \
    --zip-file fileb://lambda-package.zip \
    --region us-east-1
done
```

### 4. Deploy ECS Fargate Tasks

Build and push Docker images for Fargate tasks:

```bash
# Malware scanning worker
cd docker/malware-scan
docker build -t dms-malware-scan:latest .

# Get ECR repository URI from Terraform outputs
ECR_REPO=$(terraform output -raw ecr_repository_url)

# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

# Tag and push
docker tag dms-malware-scan:latest $ECR_REPO:latest
docker push $ECR_REPO:latest
```

### 5. Update ECS Task Definitions

```bash
aws ecs update-service \
  --cluster dms-processing-cluster \
  --service malware-scan-service \
  --force-new-deployment \
  --region us-east-1
```

### 6. Configure API Gateway

If using custom domain:

```bash
# Create custom domain
aws apigatewayv2 create-domain-name \
  --domain-name api.example.com \
  --domain-name-configurations CertificateArn=<acm-cert-arn>

# Create API mapping
aws apigatewayv2 create-api-mapping \
  --domain-name api.example.com \
  --api-id <api-id> \
  --stage prod
```

## Post-Deployment Verification

### 1. Health Check

Verify all services are running:

```bash
# Check Lambda functions
aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `dms-`)].FunctionName' \
  --output table

# Check ECS services
aws ecs list-services \
  --cluster dms-processing-cluster \
  --output table

# Check Aurora cluster
aws rds describe-db-clusters \
  --db-cluster-identifier dms-cluster-dev \
  --query 'DBClusters[0].Status'

# Check OpenSearch cluster
aws opensearch describe-domain \
  --domain-name dms-search-dev \
  --query 'DomainStatus.Processing'
```

### 2. API Endpoint Test

Test the API Gateway endpoint:

```bash
API_URL=$(terraform output -raw api_gateway_url)

# Health check (if implemented)
curl -X GET $API_URL/health

# Test authentication (should return 401)
curl -X GET $API_URL/api/v1/documents
```

### 3. Database Connectivity

Test database connection from Lambda:

```bash
aws lambda invoke \
  --function-name dms-api-handler-dev \
  --payload '{"path":"/health","httpMethod":"GET"}' \
  --region us-east-1 \
  response.json

cat response.json
```

### 4. S3 Bucket Verification

Verify S3 bucket configuration:

```bash
BUCKET=$(terraform output -raw s3_bucket_name)

# Check encryption
aws s3api get-bucket-encryption --bucket $BUCKET

# Check versioning
aws s3api get-bucket-versioning --bucket $BUCKET

# Check CORS
aws s3api get-bucket-cors --bucket $BUCKET
```

### 5. CloudWatch Logs

Verify logs are being generated:

```bash
# List log groups
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/dms- \
  --query 'logGroups[*].logGroupName'

# View recent logs
aws logs tail /aws/lambda/dms-api-handler-dev --follow
```

### 6. Monitoring Dashboard

Access CloudWatch dashboard:

```bash
aws cloudwatch get-dashboard \
  --dashboard-name dms-monitoring-dev
```

Or view in AWS Console:
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=dms-monitoring-dev

## Rollback Procedures

### Application Rollback

#### Lambda Functions

Rollback to previous version:

```bash
# List versions
aws lambda list-versions-by-function \
  --function-name dms-api-handler-dev

# Rollback to specific version
aws lambda update-alias \
  --function-name dms-api-handler-dev \
  --name prod \
  --function-version <previous-version>
```

#### ECS Fargate

Rollback to previous task definition:

```bash
# List task definitions
aws ecs list-task-definitions \
  --family-prefix dms-malware-scan

# Update service to use previous task definition
aws ecs update-service \
  --cluster dms-processing-cluster \
  --service malware-scan-service \
  --task-definition dms-malware-scan:<previous-revision>
```

### Database Rollback

Rollback migrations:

```bash
# Rollback last migration
npm run migrate:down

# Rollback to specific migration
npm run migrate:down -- --count 3
```

**Warning**: Database rollbacks may result in data loss. Always backup before rolling back.

### Infrastructure Rollback

Rollback Terraform changes:

```bash
# Revert to previous state
terraform state pull > current-state.json
terraform state push previous-state.json

# Or use version control
git checkout <previous-commit>
terraform apply
```

## Troubleshooting

### Common Issues

#### 1. Lambda Function Timeout

**Symptom**: Lambda functions timing out during execution

**Solution**:
```bash
# Increase timeout
aws lambda update-function-configuration \
  --function-name dms-api-handler-dev \
  --timeout 30
```

#### 2. Database Connection Errors

**Symptom**: "Connection refused" or "Too many connections"

**Solution**:
```bash
# Check Aurora cluster status
aws rds describe-db-clusters \
  --db-cluster-identifier dms-cluster-dev

# Check RDS Proxy connections
aws rds describe-db-proxy-targets \
  --db-proxy-name dms-proxy-dev

# Increase max connections (if needed)
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name dms-params-dev \
  --parameters "ParameterName=max_connections,ParameterValue=200,ApplyMethod=immediate"
```

#### 3. S3 Upload Failures

**Symptom**: Pre-signed URL uploads failing

**Solution**:
```bash
# Check bucket CORS configuration
aws s3api get-bucket-cors --bucket $BUCKET

# Update CORS if needed
aws s3api put-bucket-cors \
  --bucket $BUCKET \
  --cors-configuration file://cors-config.json
```

#### 4. OpenSearch Indexing Failures

**Symptom**: Documents not appearing in search results

**Solution**:
```bash
# Check OpenSearch cluster health
aws opensearch describe-domain \
  --domain-name dms-search-dev \
  --query 'DomainStatus.ClusterConfig'

# Check index status via API
curl -X GET https://<opensearch-endpoint>/_cat/indices?v
```

#### 5. Step Functions Execution Failures

**Symptom**: Processing pipeline not completing

**Solution**:
```bash
# List recent executions
aws stepfunctions list-executions \
  --state-machine-arn <state-machine-arn> \
  --status-filter FAILED

# Get execution details
aws stepfunctions describe-execution \
  --execution-arn <execution-arn>

# View execution history
aws stepfunctions get-execution-history \
  --execution-arn <execution-arn>
```

### Logs and Debugging

#### View Lambda Logs

```bash
# Tail logs in real-time
aws logs tail /aws/lambda/dms-api-handler-dev --follow

# Search logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/dms-api-handler-dev \
  --filter-pattern "ERROR"
```

#### View ECS Logs

```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --cluster dms-processing-cluster \
  --service-name malware-scan-service \
  --query 'taskArns[0]' \
  --output text)

# View logs
aws logs tail /ecs/dms-malware-scan --follow
```

#### Enable Debug Logging

Set environment variable for Lambda functions:

```bash
aws lambda update-function-configuration \
  --function-name dms-api-handler-dev \
  --environment Variables={LOG_LEVEL=debug}
```

### Performance Issues

#### High API Latency

1. Check CloudWatch metrics for API Gateway and Lambda
2. Review database query performance
3. Check RDS Proxy connection pooling
4. Consider increasing Lambda memory allocation

#### Slow Processing Pipeline

1. Check SQS queue depth and age
2. Review Step Functions execution times
3. Increase ECS Fargate task count if needed
4. Optimize worker task implementations

### Security Issues

#### Unauthorized Access

1. Verify JWT token validation
2. Check Cognito user pool configuration
3. Review IAM role permissions
4. Audit CloudTrail logs for suspicious activity

#### Data Leakage

1. Verify tenant isolation in database queries
2. Check S3 bucket policies
3. Review row-level security policies
4. Audit cross-tenant access attempts

## Support and Resources

- **AWS Documentation**: https://docs.aws.amazon.com/
- **Terraform AWS Provider**: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
- **Internal Wiki**: [Link to internal documentation]
- **On-Call Support**: [Contact information]

## Appendix

### Environment Variable Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `S3_BUCKET_NAME` | Document storage bucket | `dms-documents-dev` |
| `KMS_KEY_ID` | KMS key for encryption | `alias/dms-shared-dev` |
| `COGNITO_USER_POOL_ID` | Cognito user pool ID | `us-east-1_ABC123` |
| `COGNITO_CLIENT_ID` | Cognito app client ID | `abc123def456` |
| `OPENSEARCH_ENDPOINT` | OpenSearch cluster endpoint | `https://search-dms.us-east-1.es.amazonaws.com` |
| `STEP_FUNCTIONS_ARN` | Processing state machine ARN | `arn:aws:states:us-east-1:123456789012:stateMachine:dms-processing` |
| `LOG_LEVEL` | Logging level | `info`, `debug`, `error` |

### Terraform Module Reference

| Module | Purpose | Key Resources |
|--------|---------|---------------|
| `vpc` | Network infrastructure | VPC, subnets, NAT gateway, route tables |
| `aurora` | Database cluster | Aurora Serverless v2, RDS Proxy, parameter groups |
| `s3` | Object storage | S3 bucket, lifecycle policies, CORS |
| `kms` | Encryption keys | Shared CMK, per-tenant keys |
| `cognito` | Authentication | User pool, app clients, identity pool |
| `iam` | Access control | Roles, policies for Lambda, ECS, Step Functions |
| `opensearch` | Search engine | OpenSearch cluster, index templates |
| `sqs` | Message queues | Processing queues, DLQs |
| `step-functions` | Orchestration | State machine, task definitions |
| `cloudwatch` | Monitoring | Log groups, metrics, alarms, dashboards |

### Migration Scripts

Location: `migrations/`

| Script | Description |
|--------|-------------|
| `001_initial_schema.sql` | Creates all tables, indexes, and RLS policies |

### Deployment Checklist

- [ ] Prerequisites installed and configured
- [ ] AWS credentials configured
- [ ] Environment variables set
- [ ] Terraform backend configured (production)
- [ ] Terraform plan reviewed
- [ ] Infrastructure deployed successfully
- [ ] Database migrations completed
- [ ] Application built and packaged
- [ ] Lambda functions deployed
- [ ] ECS tasks deployed
- [ ] Post-deployment verification passed
- [ ] Monitoring dashboard accessible
- [ ] CloudWatch alarms configured
- [ ] Backup and disaster recovery tested
- [ ] Documentation updated
- [ ] Team notified of deployment

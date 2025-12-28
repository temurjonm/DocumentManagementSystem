# Document Management System (DMS)

Cloud-based document management system with secure upload, processing, and search capabilities.

## Architecture

- **Backend**: TypeScript/Node.js on AWS Lambda
- **Database**: Aurora Serverless v2 (PostgreSQL)
- **Storage**: S3 with KMS encryption
- **Processing**: Step Functions + Lambda + ECS Fargate
- **Search**: OpenSearch
- **IaC**: Terraform

## Project Structure

```
├── src/
│   ├── api/          # API Lambda handlers
│   ├── workers/      # Processing workers
│   ├── shared/       # Shared utilities
│   └── types/        # TypeScript type definitions
├── terraform/        # Infrastructure as Code
│   └── modules/      # Terraform modules
└── tests/           # Test files
```

## Setup

### Prerequisites

- Node.js 20+
- Terraform 1.6+
- AWS CLI configured

### Installation

```bash
npm install
```

### Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Run tests
npm test

# Build
npm run build
```

### Infrastructure Deployment

```bash
cd terraform
terraform init
terraform plan -var="environment=dev" -var="bucket_name_prefix=my-dms"
terraform apply -var="environment=dev" -var="bucket_name_prefix=my-dms"
```

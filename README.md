# Document Management System

Cloud-based document management with secure upload, processing, and search capabilities.

## Architecture

- Backend: TypeScript/Node.js on AWS Lambda
- Database: Aurora Serverless v2 (PostgreSQL)
- Storage: S3 with KMS encryption
- Processing: Step Functions + Lambda + ECS Fargate
- Search: OpenSearch
- Infrastructure: Terraform

## Project Structure

```
├── src/
│   ├── api/          # API handlers
│   ├── workers/      # Processing workers
│   ├── shared/       # Utilities
│   └── types/        # Type definitions
├── terraform/        # Infrastructure
├── web-ui/           # Web interface
└── docs/             # Documentation
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

### Infrastructure

```bash
cd terraform
terraform init
terraform plan -var="environment=dev" -var="bucket_name_prefix=my-dms"
terraform apply
```

## Documentation

- `docs/design.md` - System design and architecture
- `docs/api.yaml` - API specification
- `docs/deployment.md` - Deployment guide
- `docs/operations.md` - Operations runbook
- `docs/web-integration.md` - Web UI guide

# Security Checklist

## ✅ Verified Before Commit

### Credentials & Secrets
- [x] No AWS access keys in code
- [x] No AWS secret keys in code
- [x] No Cognito client secrets in code
- [x] No database passwords in code
- [x] No API keys hardcoded

### Environment Files
- [x] `.env` is gitignored
- [x] `.env.local` is gitignored
- [x] All `.env.*` files are gitignored (except `.env.example`)
- [x] Example files contain only placeholder values

### Terraform
- [x] `terraform.tfvars` is gitignored
- [x] `*.tfstate` files are gitignored
- [x] `.terraform/` directory is gitignored
- [x] No hardcoded account IDs in `.tf` files
- [x] No hardcoded resource ARNs in `.tf` files

### Application Code
- [x] All API endpoints use environment variables
- [x] All database connections use environment variables
- [x] All AWS SDK clients use environment variables
- [x] All authentication uses environment variables

### Build Artifacts
- [x] `node_modules/` is gitignored
- [x] `dist/` is gitignored
- [x] `.next/` is gitignored
- [x] `lambda-package.zip` is gitignored

### GitHub Workflows
- [x] Workflows use GitHub Secrets for credentials
- [x] No hardcoded AWS credentials in workflows

## Environment Variables Required

### Backend (.env)
```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
DATABASE_URL
S3_BUCKET_NAME
KMS_KEY_ID
COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID
```

### Web UI (web-ui/.env.local)
```
NEXT_PUBLIC_API_URL
NEXTAUTH_URL
NEXTAUTH_SECRET
COGNITO_CLIENT_ID
COGNITO_CLIENT_SECRET
COGNITO_ISSUER
COGNITO_DOMAIN
```

### Terraform (terraform/terraform.tfvars)
```
environment
aws_region
vpc_cidr
bucket_name_prefix
cognito_callback_urls
cognito_logout_urls
```

## Setup Instructions

1. Copy `.env.example` to `.env` and fill in values
2. Copy `web-ui/.env.local.example` to `web-ui/.env.local` and fill in values
3. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` and fill in values
4. Never commit the actual environment files
5. Use GitHub Secrets for CI/CD credentials

## Notes

- All sensitive files are in `.gitignore`
- Example files are safe to commit
- Always use environment variables for configuration
- Never hardcode credentials in source code

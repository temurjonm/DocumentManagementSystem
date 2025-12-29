# Operations Runbook

Day-to-day operations guide for running the Document Management System.

## System Overview

Multi-tenant document management platform with:
- API Gateway + Lambda for control plane
- Step Functions + Lambda/ECS for processing
- S3 for storage, Aurora for metadata, OpenSearch for search
- Cognito for authentication

## Key Metrics

| Metric | Target | Alert At |
|--------|--------|----------|
| API p95 latency | < 500ms | > 1s |
| API error rate | < 1% | > 5% |
| Upload success | > 99% | < 95% |
| Processing success | > 98% | < 90% |
| DLQ messages | 0 | > 0 |

## Monitoring

### CloudWatch Dashboards

Primary dashboard: CloudWatch → `dms-monitoring-{env}`

Watch these widgets:
- API request count and error rate
- Lambda concurrent executions
- Processing queue depth
- Database connections
- Storage usage

### Useful Log Queries

Recent errors:
```
fields @timestamp, @message, level, error
| filter level = "error"
| sort @timestamp desc
| limit 100
```

Slow API requests:
```
fields @timestamp, path, duration
| filter duration > 1000
| sort duration desc
| limit 50
```

Processing failures:
```
fields @timestamp, documentId, errorMessage
| filter status = "FAILED"
| sort @timestamp desc
```

## Alert Response

### High API Error Rate

**Symptoms**: API returning 5xx errors

**Check**:
```bash
# View recent errors
aws logs tail /aws/lambda/dms-init-upload-dev --follow

# Check Lambda metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=dms-init-upload-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

**Common causes**:
- Database connection timeout (Lambda not in VPC)
- Database connection pool exhausted
- Cognito misconfiguration
- S3 permissions issue

**Fix**:
- Check Lambda VPC configuration
- Increase database ACUs if needed
- Verify IAM roles have correct permissions

### Messages in Dead Letter Queue

**Symptoms**: DLQ depth > 0

**Check**:
```bash
# Get messages from DLQ
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/xxx/dms-processing-dlq-dev \
  --max-number-of-messages 10
```

**Common causes**:
- Malware scan timeout
- OCR failed on corrupted document
- OpenSearch indexing failed

**Fix**:
- Review error message in DLQ
- Fix underlying issue
- Manually reprocess if needed
- Purge DLQ if issues resolved

### High Database CPU

**Symptoms**: Aurora CPU > 80%

**Check**:
```bash
# View slow queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC;
```

**Common causes**:
- Missing database indexes
- Expensive query from search
- Too many concurrent connections

**Fix**:
- Add indexes for slow queries
- Increase Aurora ACUs
- Implement connection pooling with RDS Proxy

### Upload Failures

**Symptoms**: Users report upload errors

**Check**:
```bash
# Check S3 events
aws s3api list-object-versions \
  --bucket dms-documents-dev \
  --prefix tenant-id/documents/
```

**Common causes**:
- Pre-signed URL expired
- CORS misconfiguration
- Storage quota exceeded
- Network timeout

**Fix**:
- Check S3 CORS configuration
- Verify quota limits
- Increase pre-signed URL expiry if needed

### Search Not Working

**Symptoms**: Search returns no results or errors

**Check**:
```bash
# Check OpenSearch cluster health
aws opensearch describe-domain --domain-name dms-search-dev

# Check index
curl -X GET "https://search-endpoint/_cat/indices?v"
```

**Common causes**:
- OpenSearch cluster red/yellow
- Index missing or corrupted
- Document not indexed yet

**Fix**:
- Wait for cluster to recover (yellow → green)
- Reindex documents if needed
- Check indexing Lambda logs

## Common Tasks

### Add new user

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <user-pool-id> \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com \
  --temporary-password TempPass123!
```

### Add new tenant

```bash
psql $DATABASE_URL << EOF
INSERT INTO tenants (id, name, plan, storage_quota_gb, retention_days)
VALUES (gen_random_uuid(), 'Company Name', 'pro', 100, 90);
EOF
```

### Check tenant storage usage

```bash
psql $DATABASE_URL << EOF
SELECT 
  t.name,
  COUNT(d.id) as document_count,
  SUM(d.size_bytes) / 1024 / 1024 / 1024 as storage_gb
FROM tenants t
LEFT JOIN documents d ON t.id = d.tenant_id
WHERE d.deleted_at IS NULL
GROUP BY t.id, t.name;
EOF
```

### Reprocess failed document

```bash
# Trigger Step Functions manually
aws stepfunctions start-execution \
  --state-machine-arn <state-machine-arn> \
  --input '{"documentId": "xxx", "tenantId": "yyy"}'
```

### Force delete document

```bash
# Mark as deleted
psql $DATABASE_URL << EOF
UPDATE documents 
SET deleted_at = NOW(), status = 'deleted'
WHERE id = '<document-id>';
EOF

# Delete from S3
aws s3 rm s3://bucket/tenant-id/documents/document-id/ --recursive
```

### View Lambda logs in real-time

```bash
aws logs tail /aws/lambda/dms-init-upload-dev --follow --since 1h
```

### Scale Aurora ACUs

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier dms-cluster-dev \
  --serverless-v2-scaling-configuration \
    MinCapacity=0.5,MaxCapacity=2.0
```

## Maintenance

### Database backups

Aurora automatically backs up daily with 35-day retention. No action needed.

To create manual snapshot:
```bash
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier dms-cluster-dev \
  --db-cluster-snapshot-identifier dms-manual-snapshot-$(date +%Y%m%d)
```

### Lambda updates

```bash
# Build new version
npm run build
npm run package:lambda

# Deploy via Terraform
cd terraform
terraform apply
```

### Database migrations

```bash
# Create migration
npm run migrate:create add_new_column

# Apply migration
npm run migrate:up

# Rollback if needed
npm run migrate:down
```

### Rotate secrets

```bash
# Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# Update in Secrets Manager
aws secretsmanager update-secret \
  --secret-id dms/database/password \
  --secret-string "$NEW_PASSWORD"

# Update Aurora
aws rds modify-db-cluster \
  --db-cluster-identifier dms-cluster-dev \
  --master-user-password "$NEW_PASSWORD"
```

## Disaster Recovery

### Database restore

Restore from automated backup:
```bash
aws rds restore-db-cluster-to-point-in-time \
  --db-cluster-identifier dms-cluster-dev-restored \
  --source-db-cluster-identifier dms-cluster-dev \
  --restore-to-time 2024-01-15T12:00:00Z
```

### S3 recovery

S3 has versioning enabled. Restore deleted object:
```bash
aws s3api list-object-versions \
  --bucket dms-documents-dev \
  --prefix tenant-id/documents/doc-id/

aws s3api copy-object \
  --bucket dms-documents-dev \
  --copy-source dms-documents-dev/path?versionId=xxx \
  --key path
```

### OpenSearch restore

Restore from automated snapshot:
```bash
aws opensearch describe-domain-snapshots \
  --domain-name dms-search-dev

# Restore via AWS console (no CLI command available)
```

## Escalation

### Severity Levels

**P1 - Critical**: System down, data loss risk
- Response: Immediate
- Escalate to: Engineering lead

**P2 - High**: Major feature broken, affecting multiple users
- Response: Within 1 hour
- Escalate to: On-call engineer

**P3 - Medium**: Minor feature broken, workaround exists
- Response: Within 4 hours
- Escalate to: Team during business hours

**P4 - Low**: Cosmetic issue, no impact
- Response: Next sprint
- Escalate to: Create ticket only

### Escalation Process

1. Check this runbook for known issues
2. Check CloudWatch logs and metrics
3. If can't resolve in 30 minutes, escalate
4. Document issue and resolution in post-mortem

### Contact Information

Update with your team contacts:
- On-call engineer: [PagerDuty rotation]
- Engineering lead: [Email/Slack]
- DevOps team: [Slack channel]

## Health Checks

Run these daily or after changes:

```bash
# API health
curl https://api-endpoint/health

# Database connection
psql $DATABASE_URL -c "SELECT 1"

# Check all Lambdas
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `dms-`)].FunctionName'

# Check Step Functions
aws stepfunctions list-state-machines --query 'stateMachines[?contains(name, `dms`)].name'

# Check queues
aws sqs list-queues --query 'QueueUrls[?contains(@, `dms`)]'
```

All should return successfully. If any fail, investigate immediately.

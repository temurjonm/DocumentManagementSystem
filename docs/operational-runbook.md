# Document Management System - Operational Runbook

## Table of Contents

1. [System Overview](#system-overview)
2. [Monitoring Dashboards](#monitoring-dashboards)
3. [Alert Response Procedures](#alert-response-procedures)
4. [Common Troubleshooting Scenarios](#common-troubleshooting-scenarios)
5. [Incident Response](#incident-response)
6. [Maintenance Procedures](#maintenance-procedures)
7. [Disaster Recovery](#disaster-recovery)
8. [Escalation Procedures](#escalation-procedures)

## System Overview

### Architecture Summary

The DMS is a multi-tenant SaaS platform with the following key components:

- **Control Plane**: API Gateway + Lambda (metadata, authentication, pre-signed URLs)
- **Data Plane**: Step Functions + Lambda/ECS (document processing)
- **Storage**: S3 (documents), Aurora Postgres (metadata), OpenSearch (search)
- **Authentication**: Cognito (JWT tokens)
- **Monitoring**: CloudWatch (logs, metrics, alarms)

### Service Dependencies

```
API Gateway → Lambda → Aurora Postgres
                    → S3 (pre-signed URLs)
                    → Cognito (JWT validation)

S3 → EventBridge → Step Functions → Lambda Workers
                                  → ECS Fargate
                                  → AWS Textract
                                  → OpenSearch
```

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API p95 latency | < 500ms | > 1000ms |
| API error rate | < 1% | > 5% |
| Upload success rate | > 99% | < 95% |
| Processing success rate | > 98% | < 90% |
| Search p95 latency | < 1s | > 2s |
| DLQ message count | 0 | > 0 |

## Monitoring Dashboards

### Primary Dashboard

**Location**: CloudWatch → Dashboards → `dms-monitoring-{env}`

**URL**: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=dms-monitoring-prod

**Widgets**:

1. **API Health**
   - Request count (per minute)
   - Error rate (4xx, 5xx)
   - Latency (p50, p95, p99)
   - Throttled requests

2. **Upload Pipeline**
   - Upload initiation rate
   - Upload completion rate
   - Upload failure rate
   - Pre-signed URL generation time

3. **Processing Pipeline**
   - Documents in processing
   - Processing duration by task type
   - Processing success/failure rate
   - Queue depth (SQS)
   - DLQ message count

4. **Search Performance**
   - Search request rate
   - Search latency (p95)
   - Index size
   - OpenSearch cluster health

5. **Database**
   - Connection count
   - Query latency
   - CPU utilization
   - Storage usage

6. **Infrastructure**
   - Lambda concurrent executions
   - Lambda errors
   - ECS task count
   - S3 bucket size

### Custom Metrics Dashboard

**Location**: CloudWatch → Dashboards → `dms-custom-metrics-{env}`

**Tenant-Specific Metrics**:
- Upload volume per tenant
- Processing time per tenant
- Storage usage per tenant
- API request rate per tenant

### Log Insights Queries

**Location**: CloudWatch → Logs → Insights

#### Query 1: Recent Errors

```
fields @timestamp, @message, level, error, requestId, tenantId
| filter level = "error"
| sort @timestamp desc
| limit 100
```

#### Query 2: Slow API Requests

```
fields @timestamp, path, method, duration, tenantId, userId
| filter duration > 1000
| sort duration desc
| limit 50
```

#### Query 3: Processing Failures

```
fields @timestamp, documentId, jobType, errorMessage, attempts
| filter status = "FAILED"
| sort @timestamp desc
| limit 100
```

#### Query 4: Tenant Activity

```
fields @timestamp, action, documentId, userId
| filter tenantId = "TENANT_ID_HERE"
| stats count() by action
```

## Alert Response Procedures

### Critical Alerts

#### ALERT: High API Error Rate (5xx)

**Severity**: P1 - Critical

**Trigger**: API 5xx error rate > 5% for 5 minutes

**Impact**: Users unable to access the system

**Response Steps**:

1. **Immediate Assessment** (0-5 minutes)
   ```bash
   # Check API Gateway metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/ApiGateway \
     --metric-name 5XXError \
     --dimensions Name=ApiName,Value=dms-api-prod \
     --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Sum
   
   # Check Lambda errors
   aws logs tail /aws/lambda/dms-api-handler-prod --since 15m | grep ERROR
   ```

2. **Identify Root Cause** (5-15 minutes)
   - Check Lambda function logs for exceptions
   - Verify database connectivity
   - Check S3 bucket accessibility
   - Review recent deployments

3. **Mitigation** (15-30 minutes)
   - If recent deployment: Rollback Lambda function
   - If database issue: Check Aurora cluster status, restart if needed
   - If S3 issue: Verify bucket policies and KMS key access
   - If external dependency: Enable circuit breaker, return cached responses

4. **Recovery Verification**
   - Monitor error rate returns to < 1%
   - Test critical user flows
   - Verify no data loss

5. **Post-Incident**
   - Document root cause
   - Create incident report
   - Schedule post-mortem

**Escalation**: If not resolved in 30 minutes, escalate to senior engineer

#### ALERT: Database Connection Failures

**Severity**: P1 - Critical

**Trigger**: Database connection errors > 10 in 5 minutes

**Impact**: All API operations failing

**Response Steps**:

1. **Check Aurora Cluster Status**
   ```bash
   aws rds describe-db-clusters \
     --db-cluster-identifier dms-cluster-prod \
     --query 'DBClusters[0].Status'
   ```

2. **Check RDS Proxy**
   ```bash
   aws rds describe-db-proxies \
     --db-proxy-name dms-proxy-prod
   ```

3. **Verify Security Groups**
   ```bash
   aws ec2 describe-security-groups \
     --group-ids <aurora-sg-id>
   ```

4. **Check Connection Pool**
   - Review RDS Proxy metrics
   - Check for connection leaks in Lambda functions
   - Verify max_connections parameter

5. **Mitigation**
   - Restart RDS Proxy if needed
   - Increase max_connections if at limit
   - Deploy Lambda fix if connection leak identified

#### ALERT: DLQ Messages Detected

**Severity**: P2 - High

**Trigger**: DLQ message count > 0

**Impact**: Processing failures not being retried

**Response Steps**:

1. **Inspect DLQ Messages**
   ```bash
   aws sqs receive-message \
     --queue-url <dlq-url> \
     --max-number-of-messages 10 \
     --attribute-names All
   ```

2. **Identify Failure Pattern**
   - Check error messages in DLQ
   - Identify common failure reasons
   - Determine if systemic or isolated

3. **Fix Root Cause**
   - Deploy code fix if bug identified
   - Adjust processing rules if configuration issue
   - Increase timeout if timing out

4. **Reprocess Messages**
   ```bash
   # Move messages back to main queue
   aws sqs send-message \
     --queue-url <main-queue-url> \
     --message-body "$(aws sqs receive-message --queue-url <dlq-url> --query 'Messages[0].Body' --output text)"
   ```

5. **Monitor Reprocessing**
   - Verify messages process successfully
   - Check for new DLQ messages

### Warning Alerts

#### ALERT: High Processing Duration

**Severity**: P3 - Medium

**Trigger**: Processing p95 duration > 5 minutes

**Response Steps**:

1. **Identify Slow Tasks**
   ```bash
   # Query CloudWatch Logs
   aws logs filter-log-events \
     --log-group-name /aws/lambda/dms-processing-worker-prod \
     --filter-pattern "duration" \
     --start-time $(date -u -d '1 hour ago' +%s)000
   ```

2. **Check Resource Utilization**
   - Lambda memory usage
   - ECS CPU/memory usage
   - Textract throttling

3. **Optimize if Needed**
   - Increase Lambda memory allocation
   - Scale ECS tasks
   - Implement caching for repeated operations

#### ALERT: High Queue Depth

**Severity**: P3 - Medium

**Trigger**: SQS queue depth > 1000 for 15 minutes

**Response Steps**:

1. **Check Queue Metrics**
   ```bash
   aws sqs get-queue-attributes \
     --queue-url <queue-url> \
     --attribute-names ApproximateNumberOfMessages,ApproximateAgeOfOldestMessage
   ```

2. **Scale Workers**
   ```bash
   # Increase ECS task count
   aws ecs update-service \
     --cluster dms-processing-cluster \
     --service malware-scan-service \
     --desired-count 10
   ```

3. **Monitor Queue Drain**
   - Verify queue depth decreasing
   - Check processing success rate

## Common Troubleshooting Scenarios

### Scenario 1: User Cannot Upload Documents

**Symptoms**:
- Upload initiation fails
- Pre-signed URL generation errors
- S3 upload rejected

**Diagnosis**:

1. **Check User Authentication**
   ```bash
   # Verify JWT token
   echo $JWT_TOKEN | jwt decode -
   ```

2. **Check Tenant Permissions**
   ```bash
   # Query database
   psql $DATABASE_URL -c "SELECT * FROM tenants WHERE id = 'TENANT_ID';"
   ```

3. **Verify S3 Bucket Access**
   ```bash
   aws s3 ls s3://dms-documents-prod/TENANT_ID/
   ```

4. **Check KMS Key Access**
   ```bash
   aws kms describe-key --key-id <kms-key-id>
   ```

**Resolution**:
- Fix IAM permissions if access denied
- Update tenant configuration if misconfigured
- Verify KMS key policy includes Lambda execution role

### Scenario 2: Documents Stuck in Processing

**Symptoms**:
- Document status remains PROCESSING
- No processing job updates
- Step Functions execution not completing

**Diagnosis**:

1. **Find Step Functions Execution**
   ```bash
   aws stepfunctions list-executions \
     --state-machine-arn <state-machine-arn> \
     --status-filter RUNNING \
     --max-results 100
   ```

2. **Check Execution History**
   ```bash
   aws stepfunctions get-execution-history \
     --execution-arn <execution-arn> \
     --max-results 100
   ```

3. **Identify Stuck Task**
   - Review execution history for failed or timed-out tasks
   - Check Lambda/ECS logs for errors

**Resolution**:
- Stop stuck execution if needed
- Fix underlying issue (Lambda timeout, ECS task failure)
- Reprocess document by triggering new execution

### Scenario 3: Search Not Returning Results

**Symptoms**:
- Search returns empty results
- Documents not appearing in search
- OpenSearch errors

**Diagnosis**:

1. **Check OpenSearch Cluster Health**
   ```bash
   curl -X GET "https://<opensearch-endpoint>/_cluster/health?pretty"
   ```

2. **Verify Index Exists**
   ```bash
   curl -X GET "https://<opensearch-endpoint>/_cat/indices?v"
   ```

3. **Check Document Count**
   ```bash
   curl -X GET "https://<opensearch-endpoint>/documents/_count"
   ```

4. **Test Direct Query**
   ```bash
   curl -X POST "https://<opensearch-endpoint>/documents/_search" \
     -H 'Content-Type: application/json' \
     -d '{"query":{"match_all":{}}}'
   ```

**Resolution**:
- Reindex documents if index corrupted
- Restart OpenSearch cluster if unhealthy
- Fix indexing Lambda if documents not being indexed

### Scenario 4: Slow API Response Times

**Symptoms**:
- API latency > 1 second
- Timeout errors
- Poor user experience

**Diagnosis**:

1. **Identify Slow Endpoints**
   ```bash
   # CloudWatch Logs Insights
   fields @timestamp, path, duration
   | filter duration > 1000
   | stats avg(duration), max(duration), count() by path
   ```

2. **Check Database Query Performance**
   ```bash
   # Enable slow query log
   psql $DATABASE_URL -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
   ```

3. **Review Lambda Performance**
   - Check Lambda memory usage
   - Review cold start frequency
   - Analyze function duration

**Resolution**:
- Add database indexes for slow queries
- Increase Lambda memory allocation
- Implement caching for frequently accessed data
- Use provisioned concurrency to reduce cold starts

### Scenario 5: Tenant Data Leakage Concern

**Symptoms**:
- User reports seeing another tenant's data
- Audit logs show cross-tenant access
- Security alert triggered

**Diagnosis**:

1. **Immediate Investigation**
   ```bash
   # Check audit logs
   psql $DATABASE_URL -c "
     SELECT * FROM audit_logs 
     WHERE tenant_id != user_tenant_id 
     ORDER BY created_at DESC 
     LIMIT 100;
   "
   ```

2. **Verify Row-Level Security**
   ```bash
   psql $DATABASE_URL -c "\d+ documents"
   ```

3. **Check Application Code**
   - Review tenant_id filtering in queries
   - Verify JWT token validation
   - Check S3 key prefix generation

**Resolution**:
- **CRITICAL**: If confirmed, immediately disable affected tenant access
- Fix application code to enforce tenant isolation
- Audit all data access for affected period
- Notify security team and affected customers
- Conduct thorough security review

## Incident Response

### Incident Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P1 | Critical - System down | 15 minutes | API completely unavailable, data loss |
| P2 | High - Major functionality impaired | 1 hour | Upload failures, processing stopped |
| P3 | Medium - Degraded performance | 4 hours | Slow API, high latency |
| P4 | Low - Minor issues | 1 business day | UI glitches, non-critical errors |

### Incident Response Process

#### 1. Detection and Alerting (0-5 minutes)

- Alert received via CloudWatch Alarm
- On-call engineer notified via PagerDuty/SNS
- Acknowledge alert within 5 minutes

#### 2. Initial Assessment (5-15 minutes)

- Review monitoring dashboards
- Check recent deployments
- Identify affected components
- Determine severity level
- Create incident ticket

#### 3. Communication (15-30 minutes)

- Notify stakeholders based on severity
- Update status page if customer-facing
- Create incident Slack channel
- Post initial update

#### 4. Investigation and Mitigation (30 minutes - 4 hours)

- Follow alert-specific response procedures
- Implement temporary workarounds if needed
- Deploy fixes or rollback changes
- Monitor for improvement

#### 5. Resolution and Verification (varies)

- Verify issue resolved
- Test affected functionality
- Monitor for recurrence
- Update status page

#### 6. Post-Incident Review (within 48 hours)

- Document timeline and actions taken
- Identify root cause
- Create action items to prevent recurrence
- Schedule post-mortem meeting
- Update runbook with learnings

### Incident Communication Template

```
INCIDENT: [Brief Description]
SEVERITY: P[1-4]
STATUS: [Investigating/Identified/Monitoring/Resolved]
IMPACT: [Description of user impact]
START TIME: [Timestamp]
LAST UPDATE: [Timestamp]

CURRENT SITUATION:
[What is happening]

ACTIONS TAKEN:
- [Action 1]
- [Action 2]

NEXT STEPS:
- [Next step 1]
- [Next step 2]

ESTIMATED RESOLUTION: [Time or "Unknown"]
```

## Maintenance Procedures

### Routine Maintenance

#### Daily Tasks

- Review CloudWatch dashboards
- Check DLQ message count
- Monitor error rates
- Review audit logs for anomalies

#### Weekly Tasks

- Review and clear old CloudWatch logs
- Check database storage usage
- Review S3 bucket size and costs
- Update security patches
- Review and optimize slow queries

#### Monthly Tasks

- Review and update IAM policies
- Rotate database credentials
- Review and optimize Lambda functions
- Analyze cost trends
- Update documentation
- Test disaster recovery procedures

### Planned Maintenance

#### Database Maintenance Window

**Frequency**: Monthly, first Sunday 2-4 AM UTC

**Procedure**:

1. **Pre-Maintenance**
   ```bash
   # Notify users
   # Enable maintenance mode
   # Take database snapshot
   aws rds create-db-cluster-snapshot \
     --db-cluster-identifier dms-cluster-prod \
     --db-cluster-snapshot-identifier dms-maintenance-$(date +%Y%m%d)
   ```

2. **Maintenance Tasks**
   - Apply database patches
   - Optimize tables
   - Update statistics
   - Vacuum database

3. **Post-Maintenance**
   - Verify database health
   - Run smoke tests
   - Disable maintenance mode
   - Monitor for issues

#### Infrastructure Updates

**Frequency**: As needed, during low-traffic periods

**Procedure**:

1. **Preparation**
   - Review Terraform changes
   - Create rollback plan
   - Schedule maintenance window
   - Notify stakeholders

2. **Execution**
   ```bash
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

3. **Verification**
   - Run post-deployment checks
   - Monitor metrics
   - Test critical paths

## Disaster Recovery

### Backup Strategy

#### Database Backups

- **Automated Snapshots**: Daily, retained for 30 days
- **Manual Snapshots**: Before major changes, retained indefinitely
- **Point-in-Time Recovery**: Enabled, 5-minute granularity

#### S3 Backups

- **Versioning**: Enabled on all buckets
- **Cross-Region Replication**: Enabled for production
- **Lifecycle Policies**: Move to Glacier after 90 days

#### Configuration Backups

- **Terraform State**: Stored in S3 with versioning
- **Application Config**: Stored in Git
- **Secrets**: Stored in AWS Secrets Manager with rotation

### Recovery Procedures

#### Database Recovery

**Scenario**: Database corruption or data loss

**Recovery Time Objective (RTO)**: 1 hour
**Recovery Point Objective (RPO)**: 5 minutes

**Procedure**:

1. **Identify Recovery Point**
   ```bash
   aws rds describe-db-cluster-snapshots \
     --db-cluster-identifier dms-cluster-prod
   ```

2. **Restore from Snapshot**
   ```bash
   aws rds restore-db-cluster-from-snapshot \
     --db-cluster-identifier dms-cluster-prod-restored \
     --snapshot-identifier <snapshot-id> \
     --engine aurora-postgresql
   ```

3. **Update Application Configuration**
   - Update DATABASE_URL environment variable
   - Restart Lambda functions
   - Verify connectivity

4. **Verify Data Integrity**
   - Run data validation queries
   - Test critical operations
   - Compare record counts

#### Region Failover

**Scenario**: Complete region outage

**RTO**: 4 hours
**RPO**: 15 minutes

**Procedure**:

1. **Activate DR Region**
   - Promote read replica to primary
   - Update Route53 DNS records
   - Deploy application to DR region

2. **Verify Services**
   - Test API endpoints
   - Verify database connectivity
   - Check S3 replication status

3. **Monitor and Adjust**
   - Monitor error rates
   - Scale resources as needed
   - Communicate status to users

## Escalation Procedures

### Escalation Path

1. **Level 1**: On-call engineer (0-30 minutes)
2. **Level 2**: Senior engineer (30-60 minutes)
3. **Level 3**: Engineering manager (1-2 hours)
4. **Level 4**: CTO/VP Engineering (2+ hours or critical incidents)

### Contact Information

| Role | Contact | Availability |
|------|---------|--------------|
| On-call Engineer | PagerDuty | 24/7 |
| Senior Engineer | [Phone/Email] | Business hours + on-call rotation |
| Engineering Manager | [Phone/Email] | Business hours |
| CTO | [Phone/Email] | Critical incidents only |
| AWS Support | AWS Console | 24/7 (Enterprise Support) |

### When to Escalate

- Incident not resolved within expected timeframe
- Incident severity increases
- Multiple systems affected
- Data loss or security breach suspected
- Customer escalation received
- Uncertain about next steps

### Escalation Template

```
ESCALATION REQUEST

INCIDENT ID: [ID]
SEVERITY: P[1-4]
DURATION: [Time since incident started]
CURRENT STATUS: [Brief description]

ACTIONS TAKEN:
- [Action 1]
- [Action 2]

REASON FOR ESCALATION:
[Why escalating]

ASSISTANCE NEEDED:
[What help is needed]

CONTACT: [Your name and contact info]
```

## Appendix

### Useful Commands

#### CloudWatch

```bash
# Tail logs
aws logs tail /aws/lambda/dms-api-handler-prod --follow

# Query logs
aws logs start-query \
  --log-group-name /aws/lambda/dms-api-handler-prod \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter level = "error"'

# Get metric statistics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=dms-api-handler-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

#### Database

```bash
# Connect to database
psql $DATABASE_URL

# Check active connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
psql $DATABASE_URL -c "SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check table sizes
psql $DATABASE_URL -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;"
```

#### Lambda

```bash
# List functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `dms-`)].FunctionName'

# Get function configuration
aws lambda get-function-configuration --function-name dms-api-handler-prod

# Update function code
aws lambda update-function-code \
  --function-name dms-api-handler-prod \
  --zip-file fileb://function.zip

# Invoke function
aws lambda invoke \
  --function-name dms-api-handler-prod \
  --payload '{"test":"data"}' \
  response.json
```

#### S3

```bash
# List bucket contents
aws s3 ls s3://dms-documents-prod/ --recursive --human-readable

# Get bucket size
aws s3 ls s3://dms-documents-prod/ --recursive --summarize | grep "Total Size"

# Check bucket encryption
aws s3api get-bucket-encryption --bucket dms-documents-prod

# Generate pre-signed URL (for testing)
aws s3 presign s3://dms-documents-prod/path/to/file --expires-in 900
```

### Monitoring Queries

#### Top Error Messages

```
fields @timestamp, @message
| filter level = "error"
| stats count() by @message
| sort count desc
| limit 20
```

#### API Endpoint Performance

```
fields path, method, duration
| stats avg(duration), max(duration), count() by path, method
| sort avg(duration) desc
```

#### Tenant Activity

```
fields tenantId, action
| stats count() by tenantId, action
| sort count desc
```

### Health Check Endpoints

| Service | Endpoint | Expected Response |
|---------|----------|-------------------|
| API Gateway | `GET /health` | 200 OK |
| Aurora | `SELECT 1` | Returns 1 |
| OpenSearch | `GET /_cluster/health` | status: green/yellow |
| S3 | `HEAD /bucket` | 200 OK |

### Runbook Version

- **Version**: 1.0.0
- **Last Updated**: 2024-01-15
- **Next Review**: 2024-04-15
- **Owner**: DevOps Team

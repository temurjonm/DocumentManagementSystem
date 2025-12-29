# System Design

Multi-tenant document management system built on AWS with secure upload, automated processing, and full-text search.

## Architecture

```mermaid
graph TB
    Client[Web/Agent Client]
    
    Client --> APIGateway[API Gateway + Cognito]
    
    APIGateway --> Lambda[API Lambdas]
    APIGateway --> S3[S3 Storage]
    
    Lambda --> Aurora[(Aurora PostgreSQL)]
    Lambda --> S3
    
    S3 --> StepFunctions[Step Functions]
    
    StepFunctions --> Workers[Lambda Workers]
    StepFunctions --> ECS[ECS Fargate<br/>Malware Scan]
    StepFunctions --> Textract[AWS Textract<br/>OCR]
    
    Workers --> OpenSearch[(OpenSearch)]
    Workers --> S3
```

## Components

**API Layer**
- API Gateway: REST endpoints, JWT validation
- Lambda: Business logic, authorization
- Cognito: User authentication, token issuance

**Storage Layer**
- S3: Document storage with versioning
- Aurora Serverless v2: Metadata, tenant data
- OpenSearch: Full-text search index
- DynamoDB: Concurrency tracking

**Processing Layer**
- Step Functions: Workflow orchestration
- Lambda: Thumbnails, PDF split, indexing
- ECS Fargate: Malware scanning (ClamAV)
- Textract: OCR extraction

**Security**
- KMS: Encryption keys
- VPC: Network isolation
- IAM: Least privilege roles
- RLS: Tenant isolation in database

## Data Flows

### Upload Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Aurora
    participant S3
    participant StepFunctions
    participant Workers

    Client->>API: POST /documents/init-upload
    API->>Aurora: Save metadata (status=pending)
    API->>S3: Generate pre-signed URL
    API-->>Client: Return pre-signed URL
    
    Client->>S3: Upload file directly
    S3->>StepFunctions: Trigger processing
    
    StepFunctions->>Workers: Malware scan
    StepFunctions->>Workers: OCR extraction
    StepFunctions->>Workers: Generate thumbnail
    StepFunctions->>Workers: Index content
    
    Workers->>Aurora: Update status (ready)
```

### Download Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Aurora
    participant S3

    Client->>API: GET /documents/{id}/download
    API->>Aurora: Validate ownership
    API->>Aurora: Log audit event
    API->>S3: Generate pre-signed URL
    API-->>Client: Return pre-signed URL
    Client->>S3: Download directly
```

### Search Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant OpenSearch
    participant Aurora

    Client->>API: POST /documents/search
    API->>OpenSearch: Query with tenant filter
    OpenSearch-->>API: Return document IDs
    API->>Aurora: Fetch metadata
    API-->>Client: Return enriched results
```

## Database Schema

```mermaid
erDiagram
    TENANTS ||--o{ USERS : has
    TENANTS ||--o{ DOCUMENTS : owns
    USERS ||--o{ DOCUMENTS : uploads
    DOCUMENTS ||--o{ PROCESSING_TASKS : has
    TENANTS ||--o{ AUDIT_LOGS : generates

    TENANTS {
        uuid id PK
        text name
        text plan
        int storage_quota_gb
        int retention_days
    }

    USERS {
        uuid id PK
        uuid tenant_id FK
        text email
        text cognito_sub
        text role
    }

    DOCUMENTS {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        text filename
        bigint size_bytes
        text s3_key
        text status
        timestamp deleted_at
    }

    PROCESSING_TASKS {
        uuid id PK
        uuid document_id FK
        text task_type
        text status
        timestamp completed_at
    }

    AUDIT_LOGS {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        text action
        timestamp timestamp
    }
```

## S3 Structure

```
dms-documents-{env}/
├── {tenant-id}/
│   ├── documents/{document-id}/
│   │   ├── original/{version-id}
│   │   ├── thumbnails/{page}.jpg
│   │   └── split/{page}.pdf
│   └── temp/{upload-id}/
```

**Lifecycle**
- Incomplete uploads deleted after 7 days
- Deleted documents moved to Glacier after 30 days
- Permanent deletion after retention period

## Processing Pipeline

```mermaid
stateDiagram-v2
    [*] --> LoadRules
    LoadRules --> CheckVersion
    CheckVersion --> ParallelProcessing
    
    state ParallelProcessing {
        [*] --> MalwareScan
        [*] --> OCR
        [*] --> Thumbnail
        [*] --> SplitPDF
        
        MalwareScan --> [*]
        OCR --> [*]
        Thumbnail --> [*]
        SplitPDF --> [*]
    }
    
    ParallelProcessing --> IndexDocument
    IndexDocument --> UpdateStatus
    UpdateStatus --> [*]
```

**Error Handling**
- Retry with exponential backoff (3 attempts)
- Failed tasks move to Dead Letter Queue
- CloudWatch alarms trigger on DLQ messages

## Security

### Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Cognito
    participant APIGateway
    participant Lambda

    User->>Cognito: Login (username/password)
    Cognito-->>User: JWT tokens (id_token, access_token)
    
    User->>APIGateway: Request with Bearer token
    APIGateway->>Cognito: Validate JWT signature
    Cognito-->>APIGateway: Token valid
    APIGateway->>Lambda: Forward request with claims
```

**JWT Scopes**
- `dms/upload`: Upload documents
- `dms/read`: Read/download documents
- `dms/delete`: Delete documents
- `dms/admin`: Administrative operations

### Encryption

**At Rest**
- S3: SSE-KMS with customer managed key
- Aurora: KMS encryption enabled
- OpenSearch: Encryption at rest
- Backups: Encrypted

**In Transit**
- TLS 1.2+ for all connections
- Pre-signed URLs with HTTPS only

### Tenant Isolation

**Row-Level Security**
```sql
CREATE POLICY tenant_isolation ON documents
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

**OpenSearch**
- Separate index per tenant: `documents-{tenant-id}`
- Prevents cross-tenant queries

## Scalability

```mermaid
graph LR
    subgraph "Auto-Scaling"
        Lambda[Lambda<br/>0-1000+ concurrent]
        Aurora[Aurora<br/>0.5-128 ACUs]
        ECS[ECS Tasks<br/>Based on queue depth]
    end
    
    subgraph "No Scaling Needed"
        S3[S3<br/>Unlimited storage]
        APIGateway[API Gateway<br/>Unlimited requests]
        StepFunctions[Step Functions<br/>Automatic]
    end
```

**Concurrency Control**
- DynamoDB tracks active uploads per tenant
- Quota enforcement at upload time
- Prevents single tenant resource exhaustion

## Performance Targets

| Operation | Target Latency |
|-----------|----------------|
| Init upload | < 200ms |
| List documents | < 300ms |
| Search | < 500ms |
| Download URL | < 100ms |
| Malware scan | < 30s |
| OCR per page | < 60s |
| Thumbnail | < 5s |

## Monitoring

### Key Metrics

**API**
- Request count by endpoint
- Error rate (4xx, 5xx)
- Latency (p50, p95, p99)

**Processing**
- Documents in processing
- Success/failure rate
- Queue depth
- DLQ message count

**Infrastructure**
- Lambda concurrent executions
- Aurora CPU/memory
- OpenSearch cluster health
- Storage usage

### Alarms

**Critical** (PagerDuty)
- API error rate > 5%
- DLQ messages > 0
- Database connection failures
- OpenSearch cluster red

**Warning** (Slack)
- API latency p95 > 1s
- Processing time > 2x baseline
- Storage quota > 80%

## Disaster Recovery

### Backups

```mermaid
graph TB
    subgraph "Daily Backups"
        Aurora[Aurora<br/>35 day retention]
        OpenSearch[OpenSearch<br/>14 day retention]
    end
    
    subgraph "Continuous"
        S3[S3<br/>Versioning enabled<br/>Cross-region replication]
    end
```

**Recovery Objectives**
- RTO: 4 hours
- RPO: 24 hours

### Failure Scenarios

**Aurora Failure**
- Automatic failover to read replica (< 60s)
- No data loss (synchronous replication)

**S3 Failure**
- Automatic replication across 3 AZs
- 99.999999999% durability

**Region Failure**
- Manual failover to DR region
- Restore from snapshots

## Technology Choices

| Component | Choice | Why |
|-----------|--------|-----|
| Compute | Lambda | Pay per request, auto-scales, event-driven |
| Database | Aurora Serverless v2 | Auto-scaling, PostgreSQL, RLS support |
| Storage | S3 | Unlimited scale, versioning, lifecycle |
| Search | OpenSearch | Full-text search, managed service |
| Orchestration | Step Functions | Visual workflows, error handling |
| Malware | ECS + ClamAV | CPU-intensive, long-running |
| OCR | Textract | Managed, accurate, multi-language |

## Future Enhancements

- Document version history
- Real-time collaboration
- Mobile SDK
- Multi-region active-active
- Advanced threat detection
- Custom metadata schemas

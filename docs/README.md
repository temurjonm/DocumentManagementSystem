# Documentation

Complete documentation for the Document Management System.

## Documentation Files

### System Design
- `design.md` - Architecture, components, data flows, and design decisions

### API Documentation
- `api.yaml` - OpenAPI 3.0 specification with all endpoints, schemas, and examples

### Deployment Guide
- `deployment.md` - Infrastructure deployment, database migration, and rollback procedures

### Operations Runbook
- `operations.md` - Monitoring, incident response, and troubleshooting

### Web Integration
- `web-integration.md` - Frontend implementation guide with examples

## Quick Start

### For Developers
1. Read `design.md` to understand the system architecture
2. Review `api.yaml` for API contracts
3. Check `web-integration.md` for frontend integration

### For DevOps
1. Follow `deployment.md` for deployment steps
2. Reference `operations.md` for system operations

### For On-Call Engineers
1. Start with `operations.md`
2. Follow alert response procedures
3. Escalate using documented procedures

## Monitoring

Key metrics to watch:
- API error rate: < 1%
- API p95 latency: < 500ms
- Upload success rate: > 99%
- Processing success rate: > 98%

CloudWatch dashboards available in AWS console.

## Support

For issues or questions, refer to the operations runbook escalation procedures.

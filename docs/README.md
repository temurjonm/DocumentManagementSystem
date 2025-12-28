# Document Management System - Documentation

This directory contains comprehensive documentation for the Document Management System (DMS).

## Documentation Index

### API Documentation

- **[API Specification](./api-spec.yaml)** - OpenAPI 3.0 specification
  - Complete API endpoint documentation
  - Request/response schemas
  - Authentication requirements
  - Error codes and handling
  - Example requests and responses

**Usage**: Import into Swagger UI, Postman, or any OpenAPI-compatible tool

```bash
# View in Swagger UI
docker run -p 8080:8080 -e SWAGGER_JSON=/docs/api-spec.yaml -v $(pwd):/docs swaggerapi/swagger-ui

# Generate client SDK
openapi-generator-cli generate -i docs/api-spec.yaml -g typescript-axios -o sdk/
```

### UI Integration Documentation

- **[UI Integration Guide](./ui-integration-guide.md)** - Frontend development guide
  - Next.js implementation examples
  - Authentication flow with Cognito
  - File upload/download with pre-signed URLs
  - Document management UI components
  - Search integration
  - Real-time status updates
  - Security best practices
  - Performance optimization

**Audience**: Frontend developers building web applications that integrate with the DMS API

### Deployment Documentation

- **[Deployment Guide](./deployment-guide.md)** - Complete deployment instructions
  - Prerequisites and setup
  - Infrastructure deployment with Terraform
  - Database migrations
  - Application deployment
  - Post-deployment verification
  - Rollback procedures
  - Troubleshooting common issues

**Audience**: DevOps engineers, platform engineers, deployment teams

### Operations Documentation

- **[Operational Runbook](./operational-runbook.md)** - Day-to-day operations guide
  - Monitoring dashboards and metrics
  - Alert response procedures
  - Common troubleshooting scenarios
  - Incident response process
  - Maintenance procedures
  - Disaster recovery
  - Escalation procedures

**Audience**: On-call engineers, SREs, operations teams

## Quick Links

### For Developers

- [API Specification](./api-spec.yaml) - Understand API contracts
- [UI Integration Guide](./ui-integration-guide.md) - Build frontend applications
- [Design Document](../.kiro/specs/document-management-system/design.md) - System architecture and design decisions
- [Requirements Document](../.kiro/specs/document-management-system/requirements.md) - Functional requirements

### For DevOps

- [Deployment Guide](./deployment-guide.md) - Deploy the system
- [Operational Runbook](./operational-runbook.md) - Operate the system
- [Terraform Modules](../terraform/modules/) - Infrastructure as code

### For Operations

- [Operational Runbook](./operational-runbook.md) - Incident response and troubleshooting
- [Monitoring Dashboards](#monitoring-dashboards) - CloudWatch dashboards
- [Alert Procedures](#alert-response-procedures) - How to respond to alerts

## Getting Started

### New Team Members

1. Read the [Requirements Document](../.kiro/specs/document-management-system/requirements.md) to understand what the system does
2. Review the [Design Document](../.kiro/specs/document-management-system/design.md) to understand how it works
3. Explore the [API Specification](./api-spec.yaml) to understand the API contracts
4. Familiarize yourself with the [Operational Runbook](./operational-runbook.md) for on-call duties

### Deploying for the First Time

1. Follow the [Deployment Guide](./deployment-guide.md) step-by-step
2. Start with a development environment
3. Verify all post-deployment checks pass
4. Review the [Operational Runbook](./operational-runbook.md) before going to production

### Responding to an Incident

1. Open the [Operational Runbook](./operational-runbook.md)
2. Navigate to [Alert Response Procedures](./operational-runbook.md#alert-response-procedures)
3. Follow the procedure for your specific alert
4. Escalate if needed following [Escalation Procedures](./operational-runbook.md#escalation-procedures)

## Monitoring Dashboards

### Production Dashboards

- **Primary Dashboard**: [CloudWatch Dashboard](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=dms-monitoring-prod)
- **Custom Metrics**: [CloudWatch Dashboard](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=dms-custom-metrics-prod)
- **Log Insights**: [CloudWatch Logs Insights](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:logs-insights)

### Key Metrics to Watch

- API error rate (target: < 1%)
- API p95 latency (target: < 500ms)
- Upload success rate (target: > 99%)
- Processing success rate (target: > 98%)
- DLQ message count (target: 0)

## Support and Resources

### Internal Resources

- **Slack Channel**: #dms-support
- **Issue Tracker**: [JIRA Project](https://jira.example.com/projects/DMS)
- **Wiki**: [Confluence Space](https://wiki.example.com/display/DMS)

### External Resources

- **AWS Documentation**: https://docs.aws.amazon.com/
- **Terraform AWS Provider**: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
- **OpenAPI Specification**: https://swagger.io/specification/

### On-Call Support

- **PagerDuty**: [DMS On-Call Schedule](https://example.pagerduty.com/schedules/DMS)
- **Escalation**: See [Escalation Procedures](./operational-runbook.md#escalation-procedures)

## Contributing to Documentation

### Updating Documentation

1. Make changes to the relevant markdown or YAML files
2. Test any code examples or commands
3. Update the version and last updated date
4. Submit a pull request for review

### Documentation Standards

- Use clear, concise language
- Include code examples where helpful
- Keep procedures step-by-step
- Update regularly based on system changes
- Include troubleshooting tips from real incidents

### Review Schedule

- **API Specification**: Review quarterly or with API changes
- **Deployment Guide**: Review with infrastructure changes
- **Operational Runbook**: Review monthly and after major incidents

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-15 | Initial documentation release |

## License

Internal use only. Proprietary and confidential.

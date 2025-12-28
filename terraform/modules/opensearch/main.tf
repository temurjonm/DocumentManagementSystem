resource "aws_opensearch_domain" "dms" {
  domain_name    = "${var.environment}-dms-search"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type            = var.instance_type
    instance_count           = var.instance_count
    dedicated_master_enabled = var.instance_count >= 3
    dedicated_master_type    = var.instance_count >= 3 ? var.master_instance_type : null
    dedicated_master_count   = var.instance_count >= 3 ? 3 : null
    zone_awareness_enabled   = var.instance_count >= 2

    dynamic "zone_awareness_config" {
      for_each = var.instance_count >= 2 ? [1] : []
      content {
        availability_zone_count = min(var.instance_count, 3)
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.volume_size
    volume_type = "gp3"
    iops        = 3000
    throughput  = 125
  }

  encrypt_at_rest {
    enabled    = true
    kms_key_id = var.kms_key_id
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = false
    master_user_options {
      master_user_arn = var.master_user_arn
    }
  }

  vpc_options {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.opensearch.id]
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action   = "es:*"
        Resource = "arn:aws:es:${var.aws_region}:${var.aws_account_id}:domain/${var.environment}-dms-search/*"
        Condition = {
          IpAddress = {
            "aws:SourceIp" = var.allowed_cidr_blocks
          }
        }
      }
    ]
  })

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_application.arn
    log_type                 = "ES_APPLICATION_LOGS"
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_index_slow.arn
    log_type                 = "INDEX_SLOW_LOGS"
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_search_slow.arn
    log_type                 = "SEARCH_SLOW_LOGS"
  }

  tags = {
    Name        = "${var.environment}-dms-search"
    Environment = var.environment
    Service     = "dms"
  }

  depends_on = [
    aws_cloudwatch_log_group.opensearch_application,
    aws_cloudwatch_log_group.opensearch_index_slow,
    aws_cloudwatch_log_group.opensearch_search_slow,
  ]
}

resource "aws_security_group" "opensearch" {
  name        = "${var.environment}-dms-opensearch"
  description = "Security group for OpenSearch cluster"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "HTTPS access to OpenSearch"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name        = "${var.environment}-dms-opensearch"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_application" {
  name              = "/aws/opensearch/${var.environment}-dms-search/application"
  retention_in_days = 7

  tags = {
    Name        = "${var.environment}-dms-opensearch-application-logs"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_index_slow" {
  name              = "/aws/opensearch/${var.environment}-dms-search/index-slow"
  retention_in_days = 7

  tags = {
    Name        = "${var.environment}-dms-opensearch-index-slow-logs"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_search_slow" {
  name              = "/aws/opensearch/${var.environment}-dms-search/search-slow"
  retention_in_days = 7

  tags = {
    Name        = "${var.environment}-dms-opensearch-search-slow-logs"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_cloudwatch_log_resource_policy" "opensearch" {
  policy_name = "${var.environment}-dms-opensearch-logs"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "es.amazonaws.com"
        }
        Action = [
          "logs:PutLogEvents",
          "logs:CreateLogStream"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/opensearch/${var.environment}-dms-search/*"
      }
    ]
  })
}

# CloudWatch alarms
resource "aws_cloudwatch_metric_alarm" "cluster_status_red" {
  alarm_name          = "${var.environment}-dms-opensearch-cluster-red"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ClusterStatus.red"
  namespace           = "AWS/ES"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  alarm_description   = "OpenSearch cluster status is red"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DomainName = aws_opensearch_domain.dms.domain_name
    ClientId   = var.aws_account_id
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  tags = {
    Name        = "${var.environment}-dms-opensearch-cluster-red-alarm"
    Environment = var.environment
    Service     = "dms"
  }
}

resource "aws_cloudwatch_metric_alarm" "free_storage_space" {
  alarm_name          = "${var.environment}-dms-opensearch-low-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/ES"
  period              = 300
  statistic           = "Minimum"
  threshold           = 10240 # 10 GB in MB
  alarm_description   = "OpenSearch cluster has less than 10GB free storage"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DomainName = aws_opensearch_domain.dms.domain_name
    ClientId   = var.aws_account_id
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  tags = {
    Name        = "${var.environment}-dms-opensearch-low-storage-alarm"
    Environment = var.environment
    Service     = "dms"
  }
}

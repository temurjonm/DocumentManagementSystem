variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for OpenSearch cluster"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for OpenSearch cluster (minimum 2 for HA)"
  type        = list(string)
}

variable "instance_type" {
  description = "Instance type for data nodes"
  type        = string
  default     = "t3.medium.search"
}

variable "instance_count" {
  description = "Number of data nodes (3 recommended for HA)"
  type        = number
  default     = 3
}

variable "master_instance_type" {
  description = "Instance type for dedicated master nodes"
  type        = string
  default     = "t3.small.search"
}

variable "volume_size" {
  description = "EBS volume size in GB per data node"
  type        = number
  default     = 100
}

variable "kms_key_id" {
  description = "KMS key ID for encryption at rest"
  type        = string
}

variable "master_user_arn" {
  description = "IAM ARN for OpenSearch master user"
  type        = string
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access OpenSearch"
  type        = list(string)
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms"
  type        = string
  default     = ""
}

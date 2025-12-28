variable "environment" {
  type        = string
  description = "Environment name"
}

variable "lambda_load_rules_arn" {
  type        = string
  description = "ARN of load-processing-rules Lambda function"
}

variable "lambda_check_version_arn" {
  type        = string
  description = "ARN of check-latest-version Lambda function"
}

variable "lambda_update_status_arn" {
  type        = string
  description = "ARN of update-document-status Lambda function"
}

variable "lambda_index_document_arn" {
  type        = string
  description = "ARN of index-document Lambda function"
}

variable "malware_scan_queue_url" {
  type        = string
  description = "URL of malware scan SQS queue"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to resources"
  default     = {}
}

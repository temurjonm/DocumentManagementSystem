variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "api_gateway_name" {
  description = "Name of the API Gateway"
  type        = string
}

variable "sqs_queue_names" {
  description = "List of SQS queue names to monitor"
  type        = list(string)
  default     = []
}

variable "sqs_queue_arns" {
  description = "List of SQS queue ARNs for IAM permissions"
  type        = list(string)
  default     = []
}

variable "queue_urls" {
  description = "Map of queue URLs for Lambda environment variables"
  type        = map(string)
  default     = {}
}

variable "dlq_names" {
  description = "List of DLQ names to monitor"
  type        = list(string)
  default     = []
}

variable "alarm_email" {
  description = "Email address for alarm notifications"
  type        = string
}

variable "api_5xx_threshold" {
  description = "Threshold for API 5xx error rate alarm (errors per minute)"
  type        = number
  default     = 10
}

variable "processing_failure_threshold" {
  description = "Threshold for processing failure rate alarm (percentage)"
  type        = number
  default     = 10
}

variable "lambda_zip_path" {
  description = "Path to the Lambda deployment package"
  type        = string
}

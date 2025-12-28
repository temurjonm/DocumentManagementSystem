variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "init_upload_lambda_arn" {
  type = string
}

variable "init_upload_lambda_name" {
  type = string
}

variable "list_documents_lambda_arn" {
  type = string
}

variable "list_documents_lambda_name" {
  type = string
}

variable "get_document_lambda_arn" {
  type = string
}

variable "get_document_lambda_name" {
  type = string
}

variable "download_lambda_arn" {
  type = string
}

variable "download_lambda_name" {
  type = string
}

variable "delete_document_lambda_arn" {
  type = string
}

variable "delete_document_lambda_name" {
  type = string
}

variable "search_lambda_arn" {
  type = string
}

variable "search_lambda_name" {
  type = string
}

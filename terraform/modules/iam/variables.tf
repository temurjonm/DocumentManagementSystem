variable "environment" {
  type = string
}

variable "aurora_cluster_arn" {
  type = string
}

variable "s3_bucket_arn" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

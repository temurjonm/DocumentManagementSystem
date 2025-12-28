output "shared_cmk_arn" {
  value = aws_kms_key.shared_cmk.arn
}

output "shared_cmk_id" {
  value = aws_kms_key.shared_cmk.key_id
}

output "shared_cmk_key_id" {
  value = aws_kms_key.shared_cmk.key_id
}

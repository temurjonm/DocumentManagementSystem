resource "aws_kms_key" "shared_cmk" {
  description             = "Shared CMK for standard tenants - ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "dms-shared-cmk-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "shared_cmk" {
  name          = "alias/dms-shared-${var.environment}"
  target_key_id = aws_kms_key.shared_cmk.key_id
}

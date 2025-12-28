resource "aws_db_subnet_group" "aurora" {
  name       = "dms-aurora-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "dms-aurora-subnet-group-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_security_group" "aurora" {
  name        = "dms-aurora-${var.environment}"
  description = "Security group for Aurora PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.environment == "dev" ? ["0.0.0.0/0"] : ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "dms-aurora-sg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_rds_cluster" "aurora" {
  cluster_identifier      = "dms-cluster-${var.environment}"
  engine                  = "aurora-postgresql"
  engine_mode             = "provisioned"
  engine_version          = "16.8"
  database_name           = "dms"
  master_username         = "dms_admin"
  master_password         = random_password.db_password.result
  db_subnet_group_name    = aws_db_subnet_group.aurora.name
  vpc_security_group_ids  = [aws_security_group.aurora.id]
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn
  backup_retention_period = 7
  preferred_backup_window = "03:00-04:00"
  skip_final_snapshot     = var.environment != "prod"

  serverlessv2_scaling_configuration {
    max_capacity = 2.0
    min_capacity = 0.5
  }

  tags = {
    Name        = "dms-aurora-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_rds_cluster_instance" "aurora" {
  identifier           = "dms-instance-${var.environment}"
  cluster_identifier   = aws_rds_cluster.aurora.id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.aurora.engine
  engine_version       = aws_rds_cluster.aurora.engine_version
  publicly_accessible  = var.environment == "dev" ? true : false

  tags = {
    Name        = "dms-aurora-instance-${var.environment}"
    Environment = var.environment
  }
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "dms-db-password-${var.environment}"

  tags = {
    Name        = "dms-db-password-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = aws_rds_cluster.aurora.master_username
    password = random_password.db_password.result
    host     = aws_rds_cluster.aurora.endpoint
    port     = 5432
    database = aws_rds_cluster.aurora.database_name
  })
}

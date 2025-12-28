resource "aws_sfn_state_machine" "document_processing" {
  name     = "dms-document-processing-${var.environment}"
  role_arn = aws_iam_role.step_functions.arn

  definition = jsonencode({
    Comment = "Document Processing Pipeline"
    StartAt = "LoadRules"
    States = {
      LoadRules = {
        Type     = "Task"
        Resource = var.lambda_load_rules_arn
        Retry = [{
          ErrorEquals     = ["States.ALL"]
          IntervalSeconds = 2
          MaxAttempts     = 3
          BackoffRate     = 2.0
        }]
        Next = "CheckVersion"
      }

      CheckVersion = {
        Type     = "Task"
        Resource = var.lambda_check_version_arn
        Retry = [{
          ErrorEquals     = ["States.ALL"]
          IntervalSeconds = 2
          MaxAttempts     = 3
          BackoffRate     = 2.0
        }]
        Next = "IsLatest"
      }

      IsLatest = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.isLatest"
          BooleanEquals = true
          Next          = "UpdateStatusProcessing"
        }]
        Default = "Superseded"
      }

      Superseded = {
        Type = "Succeed"
      }

      UpdateStatusProcessing = {
        Type     = "Task"
        Resource = var.lambda_update_status_arn
        Parameters = {
          "documentId.$" = "$.documentId"
          "status"       = "PROCESSING"
        }
        Next = "ParallelProcessing"
      }

      ParallelProcessing = {
        Type = "Parallel"
        Branches = [
          {
            StartAt = "MalwareScan"
            States = {
              MalwareScan = {
                Type     = "Task"
                Resource = "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
                Parameters = {
                  QueueUrl = var.malware_scan_queue_url
                  MessageBody = {
                    "documentId.$"  = "$.documentId"
                    "versionId.$"   = "$.versionId"
                    "s3Bucket.$"    = "$.s3Bucket"
                    "s3Key.$"       = "$.s3Key"
                    "taskToken.$"   = "$$.Task.Token"
                  }
                }
                End = true
              }
            }
          },
          {
            StartAt = "CheckOCR"
            States = {
              CheckOCR = {
                Type = "Choice"
                Choices = [{
                  Variable      = "$.rules.ocr"
                  BooleanEquals = true
                  Next          = "RunOCR"
                }]
                Default = "SkipOCR"
              }
              RunOCR = {
                Type     = "Task"
                Resource = "arn:aws:states:::aws-sdk:textract:startDocumentTextDetection"
                Parameters = {
                  "DocumentLocation" = {
                    "S3Object" = {
                      "Bucket.$" = "$.s3Bucket"
                      "Name.$"   = "$.s3Key"
                    }
                  }
                }
                End = true
              }
              SkipOCR = {
                Type = "Succeed"
              }
            }
          },
          {
            StartAt = "CheckThumbnail"
            States = {
              CheckThumbnail = {
                Type = "Choice"
                Choices = [{
                  Variable  = "$.rules.thumbnail"
                  IsPresent = true
                  Next      = "GenerateThumbnail"
                }]
                Default = "SkipThumbnail"
              }
              GenerateThumbnail = {
                Type     = "Task"
                Resource = "arn:aws:states:::lambda:invoke"
                Parameters = {
                  "FunctionName" = "dms-generate-thumbnail-${var.environment}"
                  "Payload" = {
                    "documentId.$" = "$.documentId"
                    "versionId.$"  = "$.versionId"
                    "s3Bucket.$"   = "$.s3Bucket"
                    "s3Key.$"      = "$.s3Key"
                    "sizes.$"      = "$.rules.thumbnail.sizes"
                  }
                }
                End = true
              }
              SkipThumbnail = {
                Type = "Succeed"
              }
            }
          },
          {
            StartAt = "CheckPDFSplit"
            States = {
              CheckPDFSplit = {
                Type = "Choice"
                Choices = [{
                  Variable      = "$.rules.pdfSplit"
                  BooleanEquals = true
                  Next          = "SplitPDF"
                }]
                Default = "SkipPDFSplit"
              }
              SplitPDF = {
                Type     = "Task"
                Resource = "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
                Parameters = {
                  QueueUrl = var.malware_scan_queue_url
                  MessageBody = {
                    "documentId.$" = "$.documentId"
                    "versionId.$"  = "$.versionId"
                    "s3Bucket.$"   = "$.s3Bucket"
                    "s3Key.$"      = "$.s3Key"
                    "taskToken.$"  = "$$.Task.Token"
                    "jobType"      = "PDF_SPLIT"
                  }
                }
                End = true
              }
              SkipPDFSplit = {
                Type = "Succeed"
              }
            }
          }
        ]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "MarkFailed"
        }]
        Next = "IndexSearch"
      }

      IndexSearch = {
        Type     = "Task"
        Resource = var.lambda_index_document_arn
        Retry = [{
          ErrorEquals     = ["States.ALL"]
          IntervalSeconds = 2
          MaxAttempts     = 3
          BackoffRate     = 2.0
        }]
        Next = "MarkReady"
      }

      MarkReady = {
        Type     = "Task"
        Resource = var.lambda_update_status_arn
        Parameters = {
          "documentId.$" = "$.documentId"
          "status"       = "READY"
        }
        End = true
      }

      MarkFailed = {
        Type     = "Task"
        Resource = var.lambda_update_status_arn
        Parameters = {
          "documentId.$" = "$.documentId"
          "status"       = "FAILED"
          "error.$"      = "$.error"
        }
        End = true
      }
    }
  })

  tags = var.tags
}

resource "aws_iam_role" "step_functions" {
  name = "dms-step-functions-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "states.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "step_functions" {
  name = "step-functions-policy"
  role = aws_iam_role.step_functions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          var.lambda_load_rules_arn,
          var.lambda_check_version_arn,
          var.lambda_update_status_arn,
          var.lambda_index_document_arn,
          "arn:aws:lambda:*:*:function:dms-generate-thumbnail-${var.environment}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [
          "arn:aws:sqs:*:*:dms-malware-scan-${var.environment}",
          "arn:aws:sqs:*:*:dms-pdf-split-${var.environment}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection"
        ]
        Resource = "*"
      }
    ]
  })
}

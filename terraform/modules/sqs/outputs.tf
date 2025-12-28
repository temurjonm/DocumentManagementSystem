output "processing_dlq_arn" {
  description = "ARN of the processing dead letter queue"
  value       = aws_sqs_queue.processing_dlq.arn
}

output "processing_dlq_url" {
  description = "URL of the processing dead letter queue"
  value       = aws_sqs_queue.processing_dlq.url
}

output "malware_scan_queue_arn" {
  description = "ARN of the malware scan queue"
  value       = aws_sqs_queue.malware_scan_queue.arn
}

output "malware_scan_queue_url" {
  description = "URL of the malware scan queue"
  value       = aws_sqs_queue.malware_scan_queue.url
}

output "thumbnail_queue_arn" {
  description = "ARN of the thumbnail generation queue"
  value       = aws_sqs_queue.thumbnail_queue.arn
}

output "thumbnail_queue_url" {
  description = "URL of the thumbnail generation queue"
  value       = aws_sqs_queue.thumbnail_queue.url
}

output "pdf_split_queue_arn" {
  description = "ARN of the PDF split queue"
  value       = aws_sqs_queue.pdf_split_queue.arn
}

output "pdf_split_queue_url" {
  description = "URL of the PDF split queue"
  value       = aws_sqs_queue.pdf_split_queue.url
}

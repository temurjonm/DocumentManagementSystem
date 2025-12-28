output "init_upload_arn" {
  value = aws_lambda_function.api["init-upload"].invoke_arn
}

output "init_upload_name" {
  value = aws_lambda_function.api["init-upload"].function_name
}

output "list_documents_arn" {
  value = aws_lambda_function.api["list-documents"].invoke_arn
}

output "list_documents_name" {
  value = aws_lambda_function.api["list-documents"].function_name
}

output "get_document_arn" {
  value = aws_lambda_function.api["get-document"].invoke_arn
}

output "get_document_name" {
  value = aws_lambda_function.api["get-document"].function_name
}

output "download_arn" {
  value = aws_lambda_function.api["download"].invoke_arn
}

output "download_name" {
  value = aws_lambda_function.api["download"].function_name
}

output "delete_document_arn" {
  value = aws_lambda_function.api["delete-document"].invoke_arn
}

output "delete_document_name" {
  value = aws_lambda_function.api["delete-document"].function_name
}

output "search_arn" {
  value = aws_lambda_function.api["search"].invoke_arn
}

output "search_name" {
  value = aws_lambda_function.api["search"].function_name
}

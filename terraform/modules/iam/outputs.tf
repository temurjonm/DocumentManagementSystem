output "api_lambda_role_arn" {
  value = aws_iam_role.api_lambda.arn
}

output "step_functions_role_arn" {
  value = aws_iam_role.step_functions.arn
}

output "worker_role_arn" {
  value = aws_iam_role.worker.arn
}

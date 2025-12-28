output "state_machine_arn" {
  value       = aws_sfn_state_machine.document_processing.arn
  description = "ARN of the Step Functions state machine"
}

output "state_machine_name" {
  value       = aws_sfn_state_machine.document_processing.name
  description = "Name of the Step Functions state machine"
}

output "execution_role_arn" {
  value       = aws_iam_role.step_functions.arn
  description = "ARN of the Step Functions execution role"
}

# No output exposes a password, the secret value, or the user-data string.

output "db_endpoint" {
  description = "Aiven MySQL hostname, as stored in the secret envelope."
  value       = module.data.db_endpoint
}

output "db_port" {
  description = "Aiven MySQL port."
  value       = module.data.db_port
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret. The ARN, not the value."
  value       = module.data.secret_arn
  sensitive   = true
}

output "instance_id" {
  description = "EC2 instance id."
  value       = module.service.instance_id
}

output "sg_id" {
  description = "Security group id."
  value       = module.service.sg_id
}

output "app_url" {
  description = "Where the app answers. No ALB — elbv2 is unlicensed on Hobby."
  value       = "http://${module.service.app_host}:${module.service.app_port}"
}

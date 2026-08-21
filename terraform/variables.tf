variable "aws_region" {
  type        = string
  description = "AWS region. LocalStack ignores it, but the provider requires one."
  default     = "us-east-1"
}

# --- image ------------------------------------------------------------------
variable "app_ami_id" {
  type        = string
  description = <<-EOT
    LocalStack EC2 AMI id, bare form ami-<12hex>. NOT the docker tag: the tag
    localstack-ec2/app:ami-<12hex> is how LocalStack discovers the image, but
    aws_instance.ami rejects anything that is not ami-<hex>
    (InvalidAMIID.Malformed). CI supplies this from the build job's ami_id
    output.
  EOT
}

variable "app_port" {
  type        = number
  description = "Port the app listens on inside the instance."
  default     = 3000
}

variable "instance_type" {
  type        = string
  description = "Instance type. IaC only — LocalStack does not enforce vCPU/RAM."
  default     = "t3.small"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR allowed to reach the app. Never 0.0.0.0/0."
  default     = "10.0.0.0/16"
}

# --- Aiven MySQL (C2/C3) ----------------------------------------------------
# RDS is not on the LocalStack Hobby licence, so MySQL is a real managed Aiven
# instance. These arrive as TF_VAR_* from the environment and are never
# committed. Terraform writes them into Secrets Manager; the app reads them
# from there at boot.
variable "db_host" {
  type        = string
  description = "Aiven MySQL hostname."
}

variable "db_port" {
  type        = number
  description = "Aiven MySQL port (not 3306 on the free plan)."
}

variable "db_username" {
  type        = string
  description = "Aiven MySQL user."
  default     = "avnadmin"
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "Aiven MySQL password. Never committed; never an output."
}

variable "db_name" {
  type        = string
  description = "Logical database name stored in the Secrets Manager envelope."
  default     = "capacity_lab"
}

variable "secret_name" {
  type        = string
  description = "Secrets Manager secret holding the six-key DB envelope."
  default     = "regional-health/db"
}

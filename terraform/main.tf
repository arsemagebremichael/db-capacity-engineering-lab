# =============================================================================
# Individual rehost root (C1).
#
# Composes the two group platform modules — no resource blocks are copied here.
# Both are pinned to a commit SHA of the group repo, not a branch: a branch ref
# would let someone else's merge silently change what this root deploys.
#
# Group platform: https://github.com/akezasaloi/regional-health-platform
# Pinned at d56f94d742cb4238a19a707f416a945423b74ae2
#   (main, after PR #3 golden CI and PR #11 develop -> main)
#
# Not composed here, deliberately:
#   * no aws_db_instance — RDS returns 501 on the LocalStack Hobby licence;
#     MySQL is a real managed Aiven service instead (see FIDELITY.md)
#   * no aws_lb — elbv2 is also unlicensed and 501s; app_url points straight at
#     the instance, and nginx on the box carries traffic
# =============================================================================

module "data" {
  source = "git::https://github.com/akezasaloi/regional-health-platform.git//terraform/modules/data?ref=d56f94d742cb4238a19a707f416a945423b74ae2"

  db_host     = var.db_host
  db_port     = var.db_port
  db_username = var.db_username
  db_password = var.db_password
  db_name     = var.db_name
  secret_name = var.secret_name
}

module "service" {
  source = "git::https://github.com/akezasaloi/regional-health-platform.git//terraform/modules/service?ref=d56f94d742cb4238a19a707f416a945423b74ae2"

  app_ami_id    = var.app_ami_id
  instance_type = var.instance_type
  app_port      = var.app_port
  vpc_cidr      = var.vpc_cidr

  # C3 wiring: the instance receives the secret ARN and the endpoint. Never the
  # secret value — on real EC2 user-data is readable via IMDS by anything on
  # the box, and on LocalStack it sits in a world-readable file.
  secret_arn  = module.data.secret_arn
  db_endpoint = module.data.db_endpoint
  db_port     = module.data.db_port
}

# DELIBERATELY INSECURE — C5 gate demo. Reverted in the fix commit.
# "Temporary" debug access, the way it actually happens in real repos.
resource "aws_security_group" "debug" {
  name        = "capacity-api-debug"
  description = "Debug SSH access"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

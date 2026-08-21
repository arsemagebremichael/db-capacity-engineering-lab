# tflocal rewrites these endpoints to LocalStack at run time. On real AWS this
# file is unchanged: drop tflocal, unset AWS_ENDPOINT_URL, and supply real
# credentials — there is no environment branch anywhere in the config.
provider "aws" {
  region                      = var.aws_region
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true
}

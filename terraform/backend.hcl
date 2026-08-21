# Remote state. Bucket + lock table are created by bootstrap/tfstate.sh.
# The Aiven password lands in state in cleartext — there is no arrangement that
# avoids that — so the bucket is versioned, encrypted, non-public, and state is
# gitignored. Treat this bucket as a credential store.
bucket         = "tfstate-regional-health"
key            = "envs/arsema-individual/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "tfstate-lock"
encrypt        = true

# tflocal rewrites the provider but leaves the backend addressing real AWS, so
# init otherwise dies validating "test" against the genuine STS
# (InvalidClientTokenId). use_path_style matters because bootstrap/tfstate.sh
# creates the bucket path-style via awslocal.
use_path_style              = true
skip_credentials_validation = true
skip_metadata_api_check     = true
skip_region_validation      = true
skip_requesting_account_id  = true

endpoints = {
  s3       = "http://localhost:4566"
  dynamodb = "http://localhost:4566"
  sts      = "http://localhost:4566"
  iam      = "http://localhost:4566"
}

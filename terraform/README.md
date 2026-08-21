# Terraform root — individual rehost

Composes the two group platform modules. No resource blocks live here.

| Module | Source |
|---|---|
| `data` | `akezasaloi/regional-health-platform//terraform/modules/data` |
| `service` | `akezasaloi/regional-health-platform//terraform/modules/service` |

Both are pinned to a **commit SHA**, not a branch. A branch ref would let
someone else's merge silently change what this root deploys; bumping the SHA is
a reviewed PR here.

## Not composed, deliberately

- **No `aws_db_instance`.** RDS returns `501` on the LocalStack Hobby licence.
  MySQL is a real managed Aiven service; Terraform writes its connection
  envelope into Secrets Manager and the app reads it at boot. See `FIDELITY.md`.
- **No `aws_lb`.** `elbv2` is unlicensed and 501s the same way. `app_url` points
  at the instance; nginx on the box carries traffic.

## Run it

State lives on S3 + DynamoDB inside LocalStack. Initialise once with the
backend config, after which `make up` reuses the cached settings:

```bash
./bootstrap/tfstate.sh                       # create the bucket + lock table
tflocal -chdir=terraform init -backend-config=backend.hcl
make up                                      # apply + seed
make verify                                  # the five C8 checks
```

`backend.hcl` carries five LocalStack-only settings (`endpoints`,
`use_path_style`, and three `skip_*`). On real AWS **all five come out** —
credential validation must stay on and path-style addressing is deprecated.
Without them, `tflocal init` validates `test`/`test` against the genuine AWS STS
and fails with `InvalidClientTokenId`.

## Variables

`db_host`, `db_port`, `db_password` arrive as `TF_VAR_*` from the environment
(mapped from `AIVEN_*` by the Makefile) and are never committed. `app_ami_id`
is the **bare** `ami-<12hex>` id — not the `localstack-ec2/app:ami-<12hex>`
docker tag, which `aws_instance.ami` rejects as `InvalidAMIID.Malformed`.

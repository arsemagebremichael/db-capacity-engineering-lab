> ## 📋 My submission — Arsema G. Gebremichael, 2026-08-12
>
> **Findings:** [`LAB_JOURNAL.md`](./LAB_JOURNAL.md) · **Scar log:** [`SCARS.md`](./SCARS.md) · **Raw evidence:** [`evidence/`](./evidence/)
>
> | Incident | Status | Headline (all measured) |
> |---|---|---|
> | Baseline | ✅ | 3 runs + variance. **p95 varies 24% run-to-run, p99 99%** — so p99 is treated as inadmissible evidence throughout |
> | **OPS-2201** | ✅ fixed & verified | **34.09 → 4,247 req/s (124.6×)**. Not from the index the ticket implied — that made the DB 2.5× faster and moved throughput +1.6% |
> | **OPS-2202** | ✅ fixed & verified | Pool was **9% utilized**; the bottleneck was one JS thread at 3,391 req/s. Pool raise was a **documented no-op (+1.0%)** |
> | **OPS-2203** | ✅ fixed & verified | 500 ms network call inside an X row lock. **`ER_LOCK_WAIT_TIMEOUT` 89 → 0**, admits **8.61×**. Its own `p(95)<1000` gate **PASSED at 42 ms while 99.98% of requests failed** |
> | **OPS-2204** | ✅ fixed & verified | Unbounded `SELECT *` held **two** full copies. Died at **3** concurrent exports: `RestartCount` **0→10**, exit 137. Streaming: **10 → 0 restarts**, per-export RSS **35× lower** |
>
> **All four are done to the same standard** — reproduce, evidence, mechanism +
> capacity arithmetic, one concern per commit, re-measure against a known noise
> floor, and predictions **pre-registered before each fix and scored after,
> hit or miss**. Across 24 predictions that scores **12 hits, 1 split, 11
> misses** — a coin flip, and the misses are kept because the *pattern* in them
> is the most useful thing here: the single JS thread was the binding constraint
> in **all four** incidents, and I predicted something else in three of them.
> What remains unmeasured is listed in [`SCARS.md`](./SCARS.md).
>
> ### ✅ Regression found in this submission's own code — and since fixed

> **OPS-2202's pool raise (`connectionLimit` 2 → 25) introduced
> `ER_LOCK_WAIT_TIMEOUT` (MySQL 1205) on `POST /api/hospitals/:id/admit` that did
> not exist at pool=2: 89 versus 0**, confirmed with a control arm. Cause: the
> small pool was rationing access to a row lock held for 508 ms; a bigger pool
> adds waiters, not throughput, until the last waiter exceeds the 5 s lock
> timeout and queueing becomes failing.
>
> **Fixed — and not by reverting the pool.** The recommended revert to
> `MYSQL_POOL_SIZE=8` was *not* carried out, because it treated the symptom. The
> 500 ms `notifyBedRegistry` call was moved out of the transaction instead
> (`d10f8b6`): critical section **508.86 ms → 0.690 ms**, timeouts **89 → 0 at
> the unchanged pool of 25**, admits **2.30 → 19.80/s**. The pool raise was never
> the defect — only what exposed it.
>
> **The residual, stated plainly:** the fix did not remove the serialization.
> **20 row-lock waiters remain**, and the critical section still contains
> **event-loop lag** (12.1 → 29.4 ms under load), which inflates the real lock
> hold to ~50 ms — **73× the idle measurement**. The effective crossover is
> **N ≈ 100, not the ≈ 7,250** the idle number predicts, so pool 25 carries a
> **4.1× margin, not 290×**. That loop is saturated by the 466k requests
> OPS-2202's shedder rejects per run: **one incident's fix now sits inside
> another incident's critical section.** See [`SCARS.md`](./SCARS.md) scars
> **OPS-2202-R** and **OPS-2203**.
>
> **Three things worth your time if you read nothing else:**
> 1. **The obvious fix didn't work, and the journal proves it rather than
>    asserting it.** OPS-2201's index cut rows examined 10× and MySQL time 2.5×,
>    and users saw nothing, because it lowered a ceiling that wasn't binding.
> 2. **A detector I recommended after one incident was falsified by the next.**
>    `nodejs_eventloop_lag_p99` moved in OPS-2201 and stayed flat through
>    OPS-2202's 36× brownout — it samples per-turn delay, not queue depth. The
>    replacement is stated as *tested against 2 of 2, not proven*, with named
>    falsifiers.
> 3. **Two of my own experiments silently measured nothing** — harness polling
>    contending with the system under test, and env vars that never reached the
>    container. Both are written up rather than quietly re-run, because both
>    returned clean-looking tables.
>
> **10 predictions were pre-registered before measurement: 4 hit, 6 missed.** The
> misses are the most useful rows in the journal — each resolved into a specific
> named missing term.
>
> **Reproducing my runs:** the API is published on host port **3010** (a local
> Rails server holds 3000) — pass `-e BASE_URL=http://localhost:3010` to every k6
> command. See [`docker-compose.override.yml`](./docker-compose.override.yml).
> **Avoid `docker compose down`:** the `prometheus` service has no data volume,
> so a teardown destroys every metrics window listed in
> [`evidence/grafana-captures.md`](./evidence/grafana-captures.md).

---

# Regional Health — Reliability On-Call Lab 🧪

A hands-on "Lab-in-a-Box" for learning **database mechanics, performance tuning,
and capacity engineering** the way you actually learn them on the job: by picking
up an incident ticket, reproducing the symptom, and investigating until you find
the root cause.

You are the on-call engineer for the **Regional Health** platform — a healthcare
API backed by MySQL. There is an [incident queue](./incidents/README.md) of open
tickets. Each ticket is a symptom report from a user or another team. **No ticket
tells you the cause, and there is no answer key in this repo.** You diagnose it
from evidence: query plans, connection behaviour, locks, and memory, observed
through Prometheus and Grafana.

> This is a training environment seeded with realistic data and realistic
> problems. Treat it like production you've just been handed.

---

## The environment

| Component        | Tech                  | Port  | Role                                  |
|------------------|-----------------------|-------|---------------------------------------|
| `capacity-api`   | Node.js + Express     | 3000  | The application under investigation   |
| `mysql-db`       | MySQL 8.0             | 3306  | Primary relational store              |
| `mongo-db`       | MongoDB 6.0           | 27017 | Audit store                           |
| `prometheus`     | Prometheus            | 9090  | Metrics scraping                      |
| `grafana`        | Grafana               | 3001  | Dashboards                            |
| load generator   | k6                    | —     | Reproduces each incident's traffic    |

---

## Quick start (3 steps)

### 1. Start the environment
```bash
docker compose up -d --build
```
Wait ~30–60s for MySQL to become healthy (`docker compose ps`).

### 2. Seed realistic data (100,000 patients, 5 hospitals)
The seed script runs *inside* the API container:
```bash
docker compose exec capacity-api bash /usr/local/bin/seed.sh
```

### 3. Open the dashboards
- **Grafana:**    http://localhost:3001  (user `admin` / pass `admin`; anonymous admin is also enabled)
- **Prometheus:** http://localhost:9090
- **API health:** http://localhost:3000/health
- **API metrics:** http://localhost:3000/metrics

In Grafana, add Prometheus as a data source at `http://prometheus:9090`, then
chart `http_request_duration_seconds`, `http_requests_total`,
`db_errors_total`, and `nodejs_heap_size_used_bytes`. Suggested queries are in
[`LAB_JOURNAL.md`](./LAB_JOURNAL.md).

---

## Your job: work the incident queue

Open **[`incidents/README.md`](./incidents/README.md)** and pick a ticket.

The general loop for every incident:

1. **Baseline** the healthy system so you have a control group:
   ```bash
   k6 run load-tests/00-baseline.js
   ```
2. **Reproduce** the reported symptom using that ticket's script, e.g.:
   ```bash
   k6 run load-tests/reproduce-OPS-2201.js
   ```
   (Each `reproduce-OPS-XXXX.js` recreates the *traffic pattern* from ticket
   `OPS-XXXX` — it does not tell you the cause.)
3. **Investigate** with the tools below while the load runs.
4. **Diagnose, fix, and re-run** to prove the fix.
5. **Write it up** in [`LAB_JOURNAL.md`](./LAB_JOURNAL.md).

> No installed k6? Run it in Docker (Linux host networking):
> ```bash
> docker run --rm -i --network host grafana/k6 run - < load-tests/reproduce-OPS-2201.js
> ```

---

## Investigation toolbox

```bash
# Follow the application logs (crashes, errors, restarts)
docker compose logs -f capacity-api

# Live memory / CPU / restart counts per container
docker stats

# Open a MySQL shell to inspect plans, locks, and schema
docker compose exec mysql-db mysql -uroot -plabpassword capacity_lab
```

Inside the MySQL shell, techniques worth knowing:
`EXPLAIN ANALYZE <query>`, `SHOW CREATE TABLE <t>`, `SHOW ENGINE INNODB STATUS`,
and the `performance_schema` / `sys` views for locking. Which ones matter for a
given ticket is part of the exercise.

---

## Teardown
```bash
docker compose down -v
```

Good luck, on-call. 📟

---

# Assignment 2 — rehosted to the cloud

This repo is the **individual rehost**. The shared modules and the golden
pipeline live in the group platform,
[akezasaloi/regional-health-platform](https://github.com/akezasaloi/regional-health-platform),
and are consumed here by pinned commit SHA — `terraform/main.tf` for the
modules, `.github/workflows/ci.yml` for the pipeline.

## Stand it up

```bash
export LOCALSTACK_AUTH_TOKEN=...   # app.localstack.cloud -> Auth Tokens
export AIVEN_HOST=...              # your own Aiven MySQL, not a teammate's
export AIVEN_PORT=...
export AIVEN_USER=avnadmin
export AIVEN_PASSWORD=...
export AIVEN_DB=capacity_lab
export AIVEN_CA_PATH=./secrets/aiven-ca.pem   # optional: VERIFY_CA instead of REQUIRED

./bootstrap/tfstate.sh
tflocal -chdir=terraform init -backend-config=backend.hcl
make up
make verify
```

Linux only. Docker Desktop on macOS does not expose the bridge network, so
LocalStack's EC2 instances are unreachable from the host — use the Codespace.

Enable the local secret gate once per clone:

```bash
git config core.hooksPath .githooks
```

## Where the database went

RDS is not on the LocalStack Hobby licence — `aws_db_instance` returns `501`.
MySQL is therefore a real managed **Aiven** service. Terraform never creates the
database; it writes the connection envelope (`engine`, `username`, `password`,
`host`, `port`, `dbname`) into Secrets Manager, and the app calls
`GetSecretValue` at boot. The secret value never reaches the repo, the image, or
user-data — user-data receives only the ARN and the endpoint.

One operational wrinkle worth knowing before you re-run this: the Aiven free
plan **powers off after a couple of days idle** and withdraws its DNS record, so
the host stops resolving entirely. Wake it in the console first; `make up` will
otherwise fail at the seed step with what looks like a code regression.

## Deploy identity: OIDC instead of long-lived keys (E2)

CI holds no AWS keys in the production design. The deploy job would mint a
short-lived GitHub OIDC token and exchange it for a role via
`sts:AssumeRoleWithWebIdentity`. The commented `configure-aws-credentials` block
sits in the group platform's `ci.yml`; the trust policy is
[`docs/oidc-trust-policy.json`](docs/oidc-trust-policy.json). It is not enabled
here because LocalStack accepts `test`/`test` — there is nothing to federate
against.

The whole security of the arrangement rests on one condition:

```json
"token.actions.githubusercontent.com:sub":
  "repo:akezasaloi/regional-health-platform:ref:refs/heads/main"
```

### What breaks if `sub` is `repo:<org>/*`

That wildcard says *"any workflow, in any repository in this org, on any ref,
may assume this role."* Three things break, in increasing order of severity.

**1. Every branch becomes production.** `ref:refs/heads/main` is what ties the
credential to reviewed code. Drop it and any branch can assume the role — and
anyone who can push a branch can push a workflow file. Opening a PR that adds
`.github/workflows/evil.yml` is then enough to read production secrets, with no
review. Branch protection does not help: the workflow runs *before* anything
merges.

**2. Every repository in the org becomes production.** A wildcard over `<org>/*`
means the newest, least-guarded repo — a prototype, a fork, an archived service
nobody watches — can assume the same role as the deploy pipeline. The blast
radius becomes the weakest repo in the organisation, and it grows every time
someone clicks "New repository".

**3. It fails open, and silently.** A too-narrow `sub` breaks loudly: the job
cannot assume the role and CI goes red. A too-broad one works perfectly, forever,
and nothing in any log distinguishes a legitimate deploy from an attacker's
workflow — both present a valid token for the same role. There is no failure to
detect, which is why it has to be right at write time rather than found in an
incident review.

The same reasoning applies to `aud`: pinning it to `sts.amazonaws.com` stops a
token minted for another audience being replayed here.

The sharp version: the `sub` claim is an *authorisation* decision wearing
authentication's clothing. The OIDC token proves *which workflow* is asking —
GitHub signs it and it cannot be spoofed. The trust policy decides *which of
those workflows is allowed*. Widening `sub` does not weaken the cryptography at
all; it tells AWS to accept a much larger set of provably-genuine callers. The
signature stays perfect while the guarantee becomes worthless.

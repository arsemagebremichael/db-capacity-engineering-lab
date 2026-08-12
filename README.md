> ## 📋 My submission — Arsema G. Gebremichael, 2026-08-12
>
> **Findings:** [`LAB_JOURNAL.md`](./LAB_JOURNAL.md) · **Scar log:** [`SCARS.md`](./SCARS.md) · **Raw evidence:** [`evidence/`](./evidence/)
>
> | Incident | Status | Headline (all measured) |
> |---|---|---|
> | Baseline | ✅ | 3 runs + variance. **p95 varies 24% run-to-run, p99 99%** — so p99 is treated as inadmissible evidence throughout |
> | **OPS-2201** | ✅ fixed & verified | **34.09 → 4,247 req/s (124.6×)**. Not from the index the ticket implied — that made the DB 2.5× faster and moved throughput +1.6% |
> | **OPS-2202** | ✅ fixed & verified | Pool was **9% utilized**; the bottleneck was one JS thread at 3,391 req/s. Pool raise was a **documented no-op (+1.0%)** |
> | OPS-2203 | ⛔ **not investigated** | Never reproduced. Pre-registered predictions left standing, marked untested |
> | OPS-2204 | ⛔ **not investigated** | Never reproduced. One adjacent measurement: 1-VU export = 34.47 MiB, did not OOM |
>
> **Why two of four:** each was worked to the rubric's standard — reproduce,
> evidence, mechanism + capacity arithmetic, one concern per commit, re-measure
> against a known noise floor. That is slower than four thin write-ups, and I
> chose depth. The two undone are marked undone rather than padded.
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

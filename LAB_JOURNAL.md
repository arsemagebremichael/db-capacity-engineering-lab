# 🧾 On-Call Lab Journal — Regional Health

**Engineer:** Arsema G. Gebremichael  **Date:** 2026-08-12

This is your investigation notebook. You are on call for the Regional Health
platform and working the [incident queue](./incidents/README.md). For each
incident you will:

1. **Hypothesis** — from the ticket symptoms alone, predict the cause *before*
   you run anything.
2. **Observation** — record real evidence: k6 output, Grafana/Prometheus
   metrics, `EXPLAIN ANALYZE` plans, lock views, `docker stats`, container logs.
3. **Root cause & mechanism** — explain *why* it happens. Name the database/OS
   mechanic yourself and show the capacity math.
4. **Fix & verify** — make the change, re-run the reproduction, and record the
   before/after.

> There is no answer key. A claim without evidence isn't a diagnosis. "It felt
> slow" is not an observation; `p(95)=1840ms, http_req_failed=32%` is.

---

## How to capture evidence

- **k6:** copy the summary block (`http_req_duration`, `http_req_failed`,
  `iterations`, `vus`).
- **MySQL:** `docker compose exec mysql-db mysql -uroot -plabpassword capacity_lab`
  then run `EXPLAIN ANALYZE ...`, `SHOW CREATE TABLE ...`,
  `SHOW ENGINE INNODB STATUS\G`, or query `performance_schema` / `sys`.
- **Metrics:** Grafana panels or raw Prometheus at http://localhost:9090.
- **Memory / restarts:** `docker stats`, `docker compose logs -f capacity-api`.

Useful Prometheus queries:
```promql
# Throughput (req/s) by route
sum(rate(http_requests_total[1m])) by (route)

# p95 latency by route
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))

# Application heap in use
nodejs_heap_size_used_bytes

# DB errors by code
sum(rate(db_errors_total[1m])) by (code)
```

---

## Baseline — steady state (do this first)
*Run:* `k6 run load-tests/00-baseline.js` (healthy system, no incident)

Capture the control group you'll compare every incident against.

**Run 3× (not once), so I know what counts as noise before I claim any fix worked.**
Raw summaries: [`evidence/baseline/run-1.txt`](evidence/baseline/run-1.txt),
[`run-2.txt`](evidence/baseline/run-2.txt), [`run-3.txt`](evidence/baseline/run-3.txt).

| Metric              | Value |
|---------------------|-------|
| Requests/sec (RPS)  | **49.58** (49.53 – 49.60) |
| p50 latency         | **6.12 ms** (5.66 – 6.58) |
| p95 latency         | **19.30 ms** (17.82 – 22.16) |
| p99 latency         | **41.74 ms** (31.33 – 62.20) |
| Error rate          | **0.00%** (0 of 1500, all three runs) |
| Peak API heap used  | **22.17 MiB** (21.98 – 22.37) |

### Run-to-run variance — the noise floor

This is the table that decides whether a later "improvement" is real. Spread =
(max−min)/min across the three runs; CV = population coefficient of variation.

| Metric         | run 1 | run 2 | run 3 | mean  | spread | CV |
|----------------|------:|------:|------:|------:|-------:|----:|
| RPS            | 49.53 | 49.60 | 49.60 | 49.58 |   0.1% | 0.1% |
| p50 (ms)       |  6.58 |  6.12 |  5.66 |  6.12 |  16.3% | 6.1% |
| p95 (ms)       | 17.82 | 17.91 | 22.16 | 19.30 |  24.4% | 10.5% |
| p99 (ms)       | 62.20 | 31.33 | 31.69 | 41.74 |  98.5% | 34.7% |
| max (ms)       | 91.80 | 36.06 | 37.66 | 55.17 | 154.6% | 47.0% |
| peak heap (MiB)| 22.15 | 21.98 | 22.37 | 22.17 |   1.8% | 0.7% |
| peak RSS (MiB) | 98.69 | 98.19 | 98.81 | 98.56 |   0.6% | 0.3% |

### Evidence admissibility standard — set BEFORE any incident was run

This is a rule, not a preference, and it is written here — above every result —
so it is clear the bar was set before there were results to be tempted by. The
noise floor above is what justifies each line.

| Evidence class | Admissible? | Rule |
|---|---|---|
| **Error rate** | ✅ Lead with it | 0.00% across all three baseline runs. Any non-zero error rate is unambiguous signal. |
| **Throughput (RPS)** | ✅ Lead with it | 0.1% spread. Trustworthy to ~1%; a plateau under rising offered load is the strongest capacity evidence available here. |
| **Peak heap / RSS** | ✅ Lead with it | 0.6–1.8% spread. Memory deltas are the most reliable number in this lab. |
| **Mechanism counters** | ✅ Lead with it | Rows examined vs returned, lock waits, error codes, container exit codes, restart counts. These are *causal* evidence, not statistical — a full table scan is a fact about the query plan, not a sample from a distribution. |
| **p50** | ⚠️ Supporting only | 16.3% spread. Never load-bearing on its own. |
| **p95** | ⚠️ Restricted | 24.4% spread. **Admissible only for changes outside ±25%.** Any p95 delta smaller than that is reported as "within noise" and carries no argument. |
| **p99** | ❌ **Inadmissible** | 98.5% spread over only 1500 samples. **Not used as evidence anywhere in this journal.** Recorded in raw k6 output for completeness; never cited to support a conclusion. |
| **max** | ❌ Inadmissible | 154.6% spread. Single-request outlier. Same treatment as p99. |

Every incident below therefore argues from **error rate, throughput, peak heap,
and mechanism counters**, in that order. Latency percentiles appear as colour,
not as proof. This costs me nothing, because the fixes here are expected to move
numbers by multiples rather than by 20% — and if a fix only moves p95 by 20%,
the honest report is that I could not detect it.

### Discarded runs — instrumentation contending with the system under test

My first attempt at "peak heap" polled `/metrics` from the harness once per
second for the duration of each run. Those runs are **discarded and not
published**, because the instrument changed the measurement:

| | unsampled runs | 1 Hz `/metrics` polling |
|---|---|---|
| p95 | 16.08 – 17.46 ms | 20.64 – 50.53 ms |
| p99 | not captured | **296.28 ms** (run 2) |
| max | 23.55 – 38.24 ms | 317.22 ms |
| RPS | 49.52 – 49.64 | 49.25 – 49.60 |

Throughput was unaffected but the tail inflated by roughly an order of
magnitude. The cause is not mysterious: `/metrics` serializes the entire
registry on every scrape, and I was asking for that 30 extra times per run on
the same box that was running both k6 and the container — competing for the same
CPUs and, on the API side, the same single-threaded event loop that was supposed
to be serving the load.

**This is logged as a finding, not as housekeeping.** Had I not run an unsampled
control, I would have reported a real tail-latency problem in a *healthy* system
and carried that bogus baseline into all four incidents — every later comparison
would have been against a contaminated control. The published numbers take peak
heap from **Prometheus's existing 5 s scrape** (`max_over_time(...)`), which the
system is already paying for, adding zero marginal load.

The general lesson, which applies well beyond this lab: an observability probe is
a client of the system it observes. At low utilization that cost is invisible; it
becomes visible exactly when the system is stressed — which is precisely when the
measurement matters most. Prefer sampling data the system already emits over
adding a new caller during an incident.

> **SLOs I'll hold the incidents to** (derived from the measured healthy system,
> not invented): **p95 < 200 ms** (the threshold `00-baseline.js` already encodes,
> and ~10× the measured healthy p95 of 19.3 ms — generous headroom);
> **error rate < 1%**; **RPS floor ≥ 49.5 req/s** for the offered load of 50 VUs
> at 1 req/s/VU (i.e. the system must not drop requests it was offered).

**Which of those SLOs would actually have fired — derived from OPS-2201's
evidence, after the fact, not asserted up front.** OPS-2201 ran at **0.00% error
rate across all three runs**, and every single request returned **HTTP 200**.
Meanwhile `/api/patients/recent` — an endpoint nobody complained about —
degraded from 4 ms to 5.6–5.8 s, roughly **1,400×**, while still returning 200.
Two consequences follow directly:

- **An error-rate alert is blind to this class of incident.** Nothing errored.
  A page wired to `rate(http_requests_total{status_code=~"5.."})` or to
  `db_errors_total` stays silent through a total service brownout.
- **A DB-health alert is blind too.** MySQL sat at 68–74% CPU with 30% pool
  utilization and no lock waits. The DBAs' dashboard is genuinely green — as
  OPS-2202's reporter also observes. "The DB is bored" is *true* and *irrelevant*.

The detector that would have caught it is therefore neither of those. It is:

1. **A p95 latency SLO applied across ALL routes, not just the complained-about
   one.** The `recent` probe is the proof: the blast radius was service-wide, so
   a per-endpoint alert on `search` alone would have understated the incident,
   and an alert on `recent` alone would have caught a "healthy" endpoint failing.
2. **Event-loop lag** (`nodejs_eventloop_lag_p99_seconds`), which is the direct
   measure of the resource that actually ran out. It is already exported by
   `prom-client` and is on no dashboard panel in this repo.
3. **Response payload bytes per request** (`data_received / http_reqs`), the
   leading indicator: the event loop saturated because responses were 3.47 MiB.
   Payload size grows with the data set silently, long before it pages anyone.

I am recording this here rather than only in the synthesis because it changes
what I look for in the remaining three incidents: **a green error rate is not
evidence of health**, and I should probe an *uninvolved* endpoint during every
reproduction to measure blast radius rather than assume it.

### Cross-incident finding, noted at OPS-2201 — memory is nearly exhausted already

Under OPS-2201's search load alone, `docker stats` recorded
**peak RSS 148.7 MiB against the 160 MiB cgroup limit — 93% of budget** — with
heap peaking at 55 MiB. Baseline RSS is 98.6 MiB. So a *read-only search
endpoint*, with no export running at all, consumes ~50 MiB of headroom and comes
within **11.3 MiB of the OOM killer**.

This matters beyond OPS-2201 and is referenced forward:

- It means the 160 MiB budget is not "roomy except during the nightly export."
  It is nearly full during ordinary daytime search traffic, which is precisely
  when the ETL job is *not* expected to be running.
- **Forward reference to OPS-2204's blast-radius ranking:** the export incident
  should not be ranked as "a big job needs a big buffer." Search and export draw
  on the *same* 160 MiB and the same event loop. Their peaks are additive. The
  headroom for the export is not 62 MiB (160 − 98.6 baseline) but closer to
  **11 MiB whenever a shift-change search burst overlaps it** — and shift change
  and nightly batch windows are exactly the kind of thing that coincide.
- The common mechanism in both is identical: **`SELECT *` with no row limit,
  fully buffered into JS objects, then `JSON.stringify`'d into a second full
  copy.** Same bug, two endpoints, different row counts.

### Uncontended service time (W) per endpoint — 1 VU, no queueing

Raw: [`evidence/baseline/service-time-1vu.txt`](evidence/baseline/service-time-1vu.txt).
At 50–2000 VUs against a pool of 2, nearly all measured latency is *queue* time.
The capacity math (`throughput_max = pool_size / W`, Little's Law `L = λW`) needs
W as an **input**, so measuring it under load would be circular. Each endpoint got
a discarded 10-iteration warm-up first (JIT, TCP, InnoDB buffer pool), then 30
measured iterations at 1 VU.

| Endpoint | min | med | avg (**W**) | p95 | max | payload |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/patients/recent` | 0.68 ms | 0.97 ms | **1.37 ms** | 2.34 ms | 6.72 ms | small |
| `GET /api/patients/search?lastName=Smith` | 40.82 ms | 44.24 ms | **46.29 ms** | 53.82 ms | 85.62 ms | large |
| `POST /api/hospitals/1/admit` | 504.94 ms | 508.96 ms | **508.86 ms** | 511.33 ms | 515.36 ms | 36 B |
| `GET /api/patients/export` | 513.94 ms | 533.13 ms | **545.89 ms** | 618.03 ms | 639.70 ms | **36,141,185 B = 34.47 MiB** |

Four things are already visible before a single incident is reproduced:

1. **`search` costs 34× `recent`** (46.29 ms vs 1.37 ms) with *zero* contention.
   Whatever is wrong with search is wrong at 1 VU too — concurrency reveals it,
   it does not cause it.
2. **`admit` costs 508.86 ms with nothing to contend with.** An endpoint that
   writes one integer to one row has no business taking half a second. That is a
   fixed cost, not a lock wait — at 1 VU there is nobody to wait for.
3. **`export` returns 34.47 MiB per call** against a 160 MB container cap.
4. **Predicted throughput ceilings.** The right formula is `pool_size / W`, not
   `1/W`. `1/W` is the ceiling for *one* server; the pool has 2 connections, so
   two requests can be in service concurrently. Using `1/W` would understate
   every ceiling by exactly 2× and would have made the OPS-2203 arithmetic come
   out wrong in a way that happened to look plausible.

| Endpoint | W | `1/W` (one connection) | **`pool/W` = 2/W (actual ceiling)** |
|---|---:|---:|---:|
| `recent` | 1.37 ms | 730 req/s | **1,460 req/s** |
| `search` | 46.29 ms | 21.6 req/s | **43.2 req/s** |
| `admit`  | 508.86 ms | 1.97 req/s | **3.93 req/s** |
| `export` | 545.89 ms | 1.83 req/s | **3.66 req/s** |

   One important exception, which matters for OPS-2203: `pool/W` is the ceiling
   imposed by the *connection pool*. A second, independent ceiling applies when
   concurrent requests contend for the same **row**, because a row's X-lock
   serializes them no matter how many connections are free. For admits to a
   single hospital that limit is `1/W_lock` ≈ **1.97 admits/s** — half the pool
   ceiling. Whichever constraint is lower binds; for same-hospital admissions I
   expect the row lock to bind first, and for different hospitals the pool.

### Method notes (things that shape every number below)

**The baseline is NOT pool-limited — my pre-run prediction was wrong.** Before
running anything I predicted `00-baseline.js` would itself be saturated, because
50 VUs against `connectionLimit: 2` looked like an obvious bottleneck. The
measurement kills that:

- Offered load: 50 VUs ÷ (1 s sleep + 0.00137 s service) = **49.93 req/s**
- Pool ceiling: `pool / W` = 2 / 0.00137 s = **1,460 req/s**
- Little's Law: `L = λW` = 49.93 × 0.00137 = **0.068 connections in use, of 2**
- Pool utilization at baseline: **3.4%**

The baseline uses 3.4% of the pool. It is a genuine healthy control group and
the achieved 49.58 RPS ≈ the offered 49.93 RPS confirms nothing is being queued.
Recording this because I was primed to see a bottleneck and the arithmetic says
there isn't one *at this load* — the pool only matters once W gets large or
concurrency does, which is exactly what the incidents do.

**Why I work the tickets in numerical order (2201 → 2202 → 2203 → 2204).** The
pool of 2 in [`api/database.js`](api/database.js#L25) is shared by every endpoint,
so it is a confound across at least three tickets, not a property of OPS-2202
alone. Capacity is `pool / W` regardless of which endpoint is asking. If I fixed
the pool first, OPS-2201 and OPS-2203 would both partially "heal" as a
side-effect, and I would permanently lose the ability to decompose how much of
each incident is its own mechanism (table scan / row-lock serialization) versus
shared pool starvation. Working in order preserves that decomposition, which is
where the capacity arithmetic actually lives. Each incident therefore reports
its mechanism *and* its share of the pool ceiling.

**Measurement error I made and corrected.** My first attempt at "peak heap"
polled `/metrics` from the harness once per second during each run. That
contended with the system under test and inflated the tail: p99 went to 296 ms
and p95 to 20–50 ms, versus 17–22 ms p95 in otherwise identical unsampled runs.
The published numbers above take peak heap from **Prometheus's existing 5 s
scrape** via `max_over_time(...)`, adding zero load. Noted because the
contaminated run looked like a real tail-latency finding and was not.

### Pre-registered predictions — written before the incidents were run

Recorded here, timestamped ahead of the evidence, so they can be *scored* rather
than retrofitted. I read the source before forming these, which means I am primed
to confirm them; each one therefore names the artifact that would kill it, and
that artifact gets captured **whether or not it kills the prediction**. A
prediction that can only be confirmed isn't a prediction.

**P1 — OPS-2203 will NOT be a lock-wait-timeout incident.**
The chain: `connectionLimit: 2` means at most **2 transactions in flight**. Two
transactions contending for one row means at most **1 waiter**. That waiter's
worst case is the holder's critical section, ≈ **500 ms** (measured W = 508.86 ms
at 1 VU, essentially all of it the `notifyBedRegistry` sleep). The configured
`--innodb-lock-wait-timeout=5` is **10× larger** than the worst possible wait.
Therefore ER_LOCK_WAIT_TIMEOUT (**1205**) should be **near zero**, and the other
498 of 500 VUs should be stalled in the *application's* pool queue — which, with
`queueLimit: 0` (unbounded) and no acquire timeout, cannot even produce an error,
only unbounded latency.
*Prediction:* near-zero 1205s; failure signature is an app-side pool-queue stall
(timeouts/socket errors at the client), not a database error. The ticket's
"failed outright with a database error" is expected to be **wrong**.
*Killing artifact:* full error-code breakdown from the k6 run **plus the
`SHOW ENGINE INNODB STATUS` TRANSACTIONS section verbatim, captured whether or
not it shows waits.* A substantial 1205 count kills P1 outright.

**P1-corollary — the OPS-2202 fix should CREATE the OPS-2203 failure the ticket
describes.** This is the most interesting consequence and it must be tested
explicitly rather than reasoned about. The tiny pool is currently *suppressing*
lock-wait timeouts by admitting only 2 transactions at a time. Raise the pool to
N and there are N transactions contending for one row; the queue for that row
moves from the app tier into InnoDB, and the last waiter's expected wait scales
roughly as `(N−1) × 0.5 s`. That crosses the 5 s timeout at **N ≈ 11**. So a pool
of, say, 25 should produce **real 1205 errors that do not exist today**.
*Test:* after the OPS-2202 fix is committed, re-run `reproduce-OPS-2203.js`
against the enlarged pool, before applying any OPS-2203 fix, and capture the
error-code breakdown. If 1205s appear, it demonstrates a fix in one incident
manufacturing the failure mode of another — the strongest available evidence
that these four tickets are one capacity system, not four bugs.
*Killing artifact:* still near-zero 1205s at the larger pool, which would mean
the row-lock hypothesis is wrong regardless of pool size.

**P2 — OPS-2204's memory ceiling is NOT pool-limited.**
Tempting reasoning: pool of 2 ⇒ at most 2 exports at once ⇒ at most ~69 MiB ⇒
fits in 160 MiB. That reasoning is **wrong**, and P2 says why: the connection is
released back to the pool when `pool.query()` *resolves*, but the expensive
residency happens **after** that — the 100k row objects are already materialized
in the heap, and `res.json()` then runs `JSON.stringify` over them, producing a
second full copy as a 34.47 MiB string. Peak heap per in-flight export is
therefore roughly **row objects + serialized string**, and the number of exports
simultaneously holding that memory is bounded by *concurrent HTTP requests*
(50 VUs), not by pool size (2). The pool serializes *query execution*; it does
not serialize *memory residency*.
*Arithmetic:* 160 MiB cgroup − ~98 MiB baseline RSS ≈ 62 MiB headroom; at ~34.5
MiB of payload per copy and ≥2 copies live per export, the budget is exhausted
by roughly **2–3 concurrent exports**.
*Prediction:* OOM at 2–3 concurrent exports, i.e. far below 50 VUs, with the
kernel killing the process rather than V8 throwing.
*Confirming/killing artifact:* `docker inspect` **exit code 137 and a climbing
RestartCount**. Exit 137 = SIGKILL from the cgroup OOM killer, which is the only
thing that distinguishes a kernel kill from a graceful V8 heap error
(`JavaScript heap out of memory`, which would exit 134 and would mean
`--max-old-space-size=256` bound first, killing P2's mechanism). Note the 1-VU
probe already survived cleanly — RestartCount 0, exitCode 0, OOMKilled=false —
which is consistent with P2 but does not yet test it.

### Environment caveats

- Load generator (k6 v2.2.0) runs on the **same host** as the containers —
  macOS 26.x, Apple Silicon. At baseline this is irrelevant (3.4% pool use), but
  at 2000 VUs (OPS-2202) k6 itself competes for CPU. Flagged where it matters.
- The API is published on **host port 3010**, not 3000: an unrelated Rails dev
  server holds `127.0.0.1:3000` and `[::1]:3000`, and loopback-specific binds
  beat Docker's `*:3000` wildcard, so `curl localhost:3000` reached Rails. See
  [`docker-compose.override.yml`](docker-compose.override.yml). All k6 runs pass
  `-e BASE_URL=http://localhost:3010`. The container still listens on 3000
  internally, so Prometheus's `capacity-api:3000` scrape target is unchanged.
- That Rails process stays resident throughout. It is idle, but it is not zero.
- Monitoring containers are renamed `caplab-prometheus` / `caplab-grafana` to
  avoid a name collision with an unrelated project; same images, ports, volumes.
- Verified before any load: Prometheus target `capacity-api` = `up`, and Grafana's
  provisioned datasource returns live data through `/api/ds/query`.

---

## Investigation — OPS-2201
*Ticket:* [Patient name search unusably slow at shift change](./incidents/OPS-2201.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2201.js`

### Hypothesis
> From the symptoms alone (fast when isolated, collapses under concurrent
> searches, other endpoints unaffected), I think the cause is
> **no index on `patients(last_name)`, forcing a full table scan of 100,000 rows
> on every search request**, because a scan's cost is paid per-request and
> per-row: one user pays it once and barely notices, but N concurrent users
> multiply it by N against a fixed-size buffer pool and connection pool.
>
> **What would falsify this:** `EXPLAIN ANALYZE` showing `ref` access via an
> index on `last_name`, with rows-examined ≈ rows-returned. If the optimizer is
> already using an index, the scan theory is dead.
>
> **Secondary prediction (the one that turned out to matter):** if the scan is
> the binding constraint, then removing it should raise throughput. Recorded
> explicitly so it can be scored — see Fix & verify, where it is **falsified**.
>
> **Framing, stated carefully because the sloppy version is wrong:** the index is
> **not useless — it is NOT YET BINDING.** Those are different claims with
> different consequences. The index lowers a real ceiling (the pool/DB ceiling,
> measured at 98.8 req/s) that simply is not the constraint today, because the
> event-loop ceiling sits below it at 34.5 req/s. A fix that moves a
> non-binding ceiling produces no observable improvement *and is still correct
> work* — it buys headroom that becomes load-bearing the moment the binding
> constraint is lifted. The test of whether I actually understand this system is
> therefore not "does the index help" but **"can I say in advance where the
> constraint moves next, and be right."** Each fix below names the ceiling it
> expects to become binding *before* the measurement, so the model is scored
> forward rather than rationalized backward.

### Observation (evidence)

Raw evidence: [`evidence/OPS-2201/`](evidence/OPS-2201/) — `mysql-static.txt`,
`explain-analyze-before.txt`, `perf-schema-digest.txt`,
`under-load-timestamped.txt`, `under-load-saturation.txt`, `k6-before.txt`
(+ `k6-before-run1.txt`, `k6-before-run3.txt`).

**1. The scan is real. Both numbers, from `EXPLAIN ANALYZE`:**

```
-> Filter: (patients.last_name = 'Smith')  (cost=10276 rows=9819) (actual time=0.233..31.5 rows=10000 loops=1)
    -> Table scan on patients  (cost=10276 rows=98191) (actual time=0.168..27.3 rows=100000 loops=1)
```

`type: ALL`, `possible_keys: NULL`, `key: NULL`. The only index on the table is
`PRIMARY (id)` — there is no index on `last_name`.

Confirmed across 3,679 real requests, not one `EXPLAIN`
(`performance_schema.events_statements_summary_by_digest`):

```
                    query: SELECT * FROM `patients` WHERE `last_name` = ?
                    execs: 3679
        examined_per_exec: 100000
            sent_per_exec: 10000
examined_per_row_returned: 10.0
                   avg_ms: 20.25
      execs_with_no_index: 3679      <- every single execution
```

| | |
|---|---|
| **Rows examined / request** | **100,000** |
| **Rows returned / request** | **10,000** |
| **Ratio** | **10 : 1** |

**2. But the data distribution makes the "obvious fix" suspect.** `last_name`
has only **10 distinct values across 100,000 rows — 10,000 rows each**:

```
distinct_last_names: 10
Smith 10000 | Johnson 10000 | Williams 10000 | Brown 10000 | Jones 10000
Garcia 10000 | Miller 10000 | Davis 10000 | Rodriguez 10000 | Martinez 10000
```

Selectivity is **10%** — dreadful for a B-tree index. An index would cut rows
*examined* 100,000 → 10,000, but rows *returned* stays 10,000 either way, and
each row carries a 180-character `notes` TEXT column.

**3. Measured payload: 3.47 MiB per search response.** 10,000 rows × 363.6
bytes. The `recent` endpoint the reporter compares against returns **18 KB** —
a **200× difference** between the two endpoints on the same screen.

**4. Under load, MySQL is NOT the saturated resource.** Sampled 1/s from inside
the container, timestamps cross-checked against the k6 window
(`under-load-timestamped.txt`):

```
unix=1786506199 app_conns=2 running=1 sleeping=1   innodb_rows_read=201546177
unix=1786506202 app_conns=2 running=1 sleeping=1   innodb_rows_read=211315843
unix=1786506203 app_conns=2 running=0 sleeping=2   innodb_rows_read=214877151
...
unix=1786506214 (load ends; innodb_rows_read flatlines at 250277195)
```

**9 of 15 in-window samples show 1 busy connection, 6 show 0 → mean 0.6 of 2
connections busy = 30% pool utilization.** The connection pool is *not*
exhausted during OPS-2201, and MySQL spends most of its time idle-waiting.

**5. The saturated resource is the API's CPU — specifically its single JS
thread** (`under-load-saturation.txt`, `docker stats` during load):

```
capacity-api: CPU=148.87% MEM=109.5MiB / 160MiB (68.44%)
mysql-db:     CPU=68.31%  MEM=506.3MiB / 7.75GiB (6.38%)
capacity-api: CPU=153.13% MEM=86.11MiB / 160MiB (53.82%)
mysql-db:     CPU=74.39%  MEM=506.3MiB / 7.75GiB (6.38%)
```

From Prometheus over the same window, `rate(process_cpu_seconds_total[10s])`
sits at **1.47–1.49 cores sustained**. Node runs JS on one thread; the balance
(~0.48 core) is GC and libuv. **The JS main thread is pinned at 100%.**

**6. The reporter's key claim is FALSIFIED.** The ticket says *"The 'recent
patients' panel on the same screen is always fast, even when search is dying."*
I probed `/api/patients/recent` concurrently with the search storm:

| Probe during search load | Idle |
|---|---|
| 5.590 s | 0.0043 s |
| 5.804 s | 0.0042 s |
| 5.783 s | 0.0036 s |
| 3.526 s | 0.0041 s |

**`recent` degrades ~1,400×, from 4 ms to 5.6–5.8 s.** It is not fast. It
returns HTTP 200, so a browser panel that eventually renders may *look* healthy
to a nurse who has already given up on the search box — but the endpoint is as
dead as search is. Any diagnosis built on "only search is affected" would have
sent me hunting for something search-specific and missed a whole-service
saturation.

**7. k6 reproduction, 3 runs** (200 VUs, 30 s, no sleep):

| Run | RPS | p95 | errors | data received |
|---|---:|---:|---:|---:|
| 1 | 33.63 | 7.04 s | 0.00% | 4.4 GB @ 122 MB/s |
| 2 | 34.55 | 6.72 s | 0.00% | 4.5 GB @ 126 MB/s |
| 3 | see `k6-before-run3.txt` | | | |

| Metric (under load) | Value | vs. baseline |
|---------------------|-------|--------------|
| p95 latency         | 6.72–7.04 s | **~350× worse** than 19.30 ms (far outside the ±25% admissible band) |
| RPS                 | 33.63–34.55 | offered load unbounded (no sleep); throughput **plateaus**, it does not scale |
| Error rate          | **0.00%** | unchanged — nothing fails, everything is just slow |
| Rows examined / req | **100,000** | vs 50 for `recent`; **2,000×** |
| Peak RSS            | **148.7 MiB / 160 MiB (93%)** | vs 98.6 MiB baseline — within 11 MiB of OOM |

**Zero errors is itself a finding.** This incident is invisible to any alert
watching error rate or DB health. It is only visible in latency and saturation.

**8. Not measured / not applicable:** no lock waits were inspected for this
incident — with 30% pool utilization, a single-table read-only `SELECT`, and no
transactions in the search path, there is no lock contention to find. `p99` and
`max` figures appear in the raw k6 files but are **inadmissible** under the
evidence standard above and are not used in any argument here.

### Root cause & mechanism

**The headline, stated plainly because it is the answer to "the suspected cause
may be wrong":**

> **The 124.6× throughput improvement came from changing what the application
> ships, not from the index the ticket implied. The database got 2.5× faster and
> users saw nothing.**

That single pair of measurements is the whole lesson of OPS-2201. The index —
the fix everyone reaches for when a search endpoint is slow — cut rows examined
by 10× and MySQL service time from 20.25 ms to 8.1 ms, a real and verifiable
improvement to the database, and moved user-visible throughput by **+1.6%,
inside run-to-run variance**. What actually mattered was that every search
response was **3.47 MiB** of JSON that one thread had to build.

**The mechanism, named at the level of which resource ran out and why.**

Per request, before any fix:

1. MySQL executes `SELECT * FROM patients WHERE last_name = ?` with **no index
   on `last_name`**, so the access path is a **full table scan of the clustered
   PRIMARY B-tree** — InnoDB walks all 100,000 leaf rows and applies the filter
   to each, keeping 10,000. Rows examined **100,000**, rows returned **10,000**,
   ratio **10:1**. Cost: 20.25 ms of MySQL time.
2. `mysql2` materializes those 10,000 rows into **10,000 JavaScript objects**,
   each with 7 properties including a 180-character `notes` string. Measured
   cost ≈ **1.21 µs/row ⇒ ~12.1 ms** on the JS main thread.
3. `res.json()` runs **`JSON.stringify` over the whole array**, producing a
   second full copy as a **3.47 MiB string**, then writes it to the socket.
   Measured cost ≈ **4.69 ns/byte ⇒ ~17.1 ms** on the JS main thread.

Steps 2 and 3 run on **Node's single JS thread**. Step 1 does not — it is async
I/O, and two of them can overlap across the 2-connection pool. So the two
ceilings are:

```
pool / W_db          = 2 / 20.25 ms  =  98.8 req/s     <- the DB ceiling
1 thread / W_js      = 1 / 28.9 ms   =  34.5 req/s     <- BINDS
observed                                34.55 req/s
```

**The resource that ran out is the single JS thread's CPU time**, consumed by
serializing an oversized result set. Not the disk, not MySQL's CPU (68–74%,
with 65% of its pool capacity idle), not memory, not the network.

**Why it "collapses under concurrency but is fine alone" — the reporter's actual
observation, explained.** At 1 VU the cost is real but invisible: 46.29 ms is
fast enough to feel instant. The endpoint has a hard ceiling of 34.5 req/s, so
below that offered load, latency is flat. Above it, arrivals exceed service
capacity and the queue grows without bound — classic unbounded queueing, where
latency is set by queue depth rather than by work. Little's Law gives the whole
curve: `W = L/λ` = 200 VUs / 34.55 req/s = **5.79 s**, versus 5.32 s measured
(8.8% error). Concurrency did not make the query slower; **it made the queue
longer.** The per-request cost was constant all along.

**Why every other endpoint died too.** The queue is the *event loop itself*, and
every route shares it. A trivial `/api/patients/recent` request arriving mid-storm
waits behind ~200 queued requests × 28.9 ms = **5.79 s predicted, 5.59–5.80 s
measured (1.0% error)**. This is head-of-line blocking on a shared single-threaded
resource, and it is why the incident is a *service* outage rather than a *search*
outage — a distinction the ticket got wrong.

**Cost difference vs. the ideal, for ~100,000 rows.** The ideal for a search
endpoint is to examine only matching rows and return only one page of them:

| | examined | returned | payload | JS cost/req | ceiling |
|---|---:|---:|---:|---:|---:|
| As found | 100,000 | 10,000 | 3.47 MiB | 28.9 ms | 34.5 req/s |
| Index only | 10,000 | 10,000 | 3.47 MiB | 28.9 ms | 34.5 req/s |
| Index + projection | 10,000 | 10,000 | 1.48 MiB | 19.6 ms | 51.1 req/s |
| **Index + projection + paging** | **50** | **50** | **7.4 KiB** | **0.235 ms** | **4,247 req/s** |

**2,000× fewer rows examined, 477× smaller payload, 124.6× more throughput.**
The scan mattered — but only as one of three multiplicative terms, and the
smallest of them.

### Fix & verify

Three separate commits, each one mechanism, each with its own k6 pair — so I can
attribute *which* change moved the ceiling rather than shipping a bundle and
guessing. Same reasoning as the ticket ordering.

#### The constraint ladder — predicted BEFORE measuring

Written in advance. The point of the exercise is not that each fix helps; it is
whether I can name **where the constraint moves next** and be right. A model that
only explains results after the fact isn't a model.

| Step | Change | Mechanism it attacks | Ceiling it moves | **Predicted binding constraint after** | **Predicted RPS** |
|---|---|---|---|---|---|
| — | *(before)* | — | — | event loop @ 28.9 ms/req | 34.5 (measured) |
| **A** | `CREATE INDEX idx_patients_last_name` | rows examined 100,000 → 10,000 | pool/DB ceiling 98.8 → higher | **still the event loop** — unchanged | **~34.5 (no change)** |
| **B** | Drop `notes` from the search projection | bytes per row 363.6 → ~173 | event-loop ceiling ~34.5 → ~70 | **still the event loop**, but ~2× higher | **~65–75** |
| **C** | `LIMIT 50` on search | rows returned 10,000 → 50 | event-loop ceiling ~70 → ~1,000+ | **moves OFF the event loop** — to the pool (2 connections) or to the host/k6 harness itself | **several hundred+; no longer payload-bound** |

Reasoning behind each number:

- **A:** the event loop still materializes 10,000 row objects and stringifies
  3.47 MiB. Nothing in that path is touched by an index. RPS should land inside
  the ±1% RPS noise band of 34.5.
- **B:** `notes` is 180 chars/row, ~190 bytes of JSON including the key and
  quoting — roughly **52% of the 363.6 B row**. If JS CPU per request scales with
  bytes serialized, 28.9 ms → ~13.9 ms, ceiling 34.5 → ~72 req/s. If measured
  throughput lands near 70, serialization cost is confirmed to be
  **bytes-driven**. If it lands near 34.5, the cost is **row-count-driven**
  (object allocation, not stringification) and my model of *why* is wrong even
  though the direction was right.
- **C:** 50 rows × ~363 B ≈ 18 KB, the same shape as `/api/patients/recent`,
  which serves 1,460 req/s by the pool math and ~730 req/s per JS-thread
  arithmetic. At that point the payload no longer dominates and something else
  must bind. **I predict the binding constraint stops being inside the API
  process.** Candidates, in the order I expect them: the 2-connection pool, then
  the host CPU shared with k6.

**This is the falsifiable claim:** if post-fix throughput lands near a ceiling I
named *beforehand*, the model works forward. If it lands somewhere I did not
predict, the model is wrong and I will say which input was wrong, not
retro-fit the explanation.

#### Step A — index (results) → [`evidence/OPS-2201/fixA-index.txt`](evidence/OPS-2201/fixA-index.txt)

**Change:** `CREATE INDEX idx_patients_last_name ON patients(last_name);`, added
to [`data-seed/seed.sh`](data-seed/seed.sh) so fresh environments get it.

**New query behaviour:**
```
BEFORE:  type: ALL   possible_keys: NULL   -> Table scan on patients (actual ... rows=100000)
AFTER:   type: ref   key: idx_patients_last_name   rows: 10000   filtered: 100.00
         -> Index lookup on patients using idx_patients_last_name (last_name='Smith')
            (cost=2371 rows=10000) (actual time=0.022..11.4 rows=10000 loops=1)
```

| | before | after | |
|---|---:|---:|---|
| rows examined / exec | 100,000 | **10,000** | 10× fewer |
| rows sent / exec | 10,000 | 10,000 | unchanged — *the index cannot change this* |
| examined : sent | 10:1 | **1:1** | optimal |
| MySQL time / search | 20.25 ms | **8.1 ms** | 2.5× faster |
| `no_index_used` execs | 3,679 | **0** | |
| pool/DB ceiling | 98.8 req/s | **~247 req/s** | 2.5× higher |
| **throughput** | **34.09 req/s** | **34.64 req/s** | **+1.6%** |

Four post-index runs: 24.46 (cold — index freshly built, discarded as
warm-up), then **34.13, 35.50, 34.28**. Mean of the warm runs 34.64 vs 34.09
before — inside the before-runs' own spread (33.63–34.55).

**Predicted ~34.5, measured 34.64. ✅ CONFIRMED.** The database got 2.5× faster
and the user-visible throughput did not move, because the constraint was never
the database. This is the clearest single result in the incident: **a correct
fix, verified to have made the system measurably better in the dimension it
targets, and verified to have changed nothing a user could perceive.**

**Constraint after:** unchanged — the event loop, at 34.5 req/s.

#### Step B — column projection (results) → [`evidence/OPS-2201/fixB-projection.txt`](evidence/OPS-2201/fixB-projection.txt)

**Change:** [`api/server.js`](api/server.js) — `SELECT *` →
`SELECT id, first_name, last_name, email, diagnosis, created_at`, dropping the
`notes` TEXT column. Safe because `/api/patients/export` is a **separate handler
with its own SQL** ([server.js:156-165](api/server.js#L156-L165) vs
[:98-111](api/server.js#L98-L111)) — verified, no shared query builder — so the
ETL extract is untouched by this projection.

| | before | after |
|---|---:|---:|
| bytes / row | 363.6 B | **155.3 B** |
| payload / response | 3.47 MiB | **1.48 MiB** (−57.3%) |
| **throughput** | 34.09 req/s | **51.13 req/s** (3 runs: 51.92 / 51.43 / 50.05) |

**Predicted 65–75, measured 51.13. ❌ PREDICTION MISSED — too high.**

The direction was right, the magnitude was wrong, and the error was
informative. I had assumed serialization cost scales with **bytes alone**. If it
did, a 57.3% byte cut would give 2.34× throughput ≈ 80 req/s. The actual gain
was 1.50×. Fitting the two points gives a **two-term cost**:

```
js_cost_per_request = 4.69 ns/byte  +  1.21 us/row
                      ^ serialization     ^ mysql2 row-object materialization,
                        + socket write      which does NOT shrink when you drop
                                            a column
```

After the projection, the **per-row term is 62% of the remaining cost**.
Dropping columns cannot touch it. Only dropping *rows* can — which is Step C,
and this is why Step C was worth doing as a separate commit rather than bundled.

**Constraint after:** still the event loop, ceiling raised 34.5 → 51.1 req/s.

#### Step C — pagination (results) → [`evidence/OPS-2201/fixC-pagination.txt`](evidence/OPS-2201/fixC-pagination.txt)

**Change:** [`api/server.js`](api/server.js) — added `ORDER BY id LIMIT ? OFFSET ?`
with `DEFAULT_PAGE_SIZE=50`, `MAX_PAGE_SIZE=200` (both env-overridable), and
`limit`/`offset` echoed in the response body.

| | before all fixes | after Step C |
|---|---:|---:|
| rows returned | 10,000 | **50** |
| payload | 3,636,195 B (3.47 MiB) | **7,618 B (7.4 KiB)** — **477× smaller** |
| rows examined / exec | 100,000 | **50** |
| MySQL time / query | 20.25 ms | **0.074 ms** |
| **throughput** | **34.09 req/s** | **4,247 req/s** (4,211.9 / 4,275.9 / 4,254.3) |
| p95 | 6.72–7.04 s | **52.67–58.59 ms** |
| error rate | 0.00% | **0.00%** |
| peak RSS | 148.7 MiB (93% of cap) | **46.5 MiB (29% of cap)** |

**Predicted "several hundred req/s, constraint leaves the event loop."
Measured 4,247 req/s, and the constraint did NOT leave the event loop.
❌ WRONG ON MECHANISM, and wrong on magnitude in the other direction.**

Evidence that it is still the API process ([`fixC-where-is-constraint.txt`](evidence/OPS-2201/fixC-where-is-constraint.txt)):

```
capacity-api: CPU=142.79%  mysql-db: CPU=36.50%   mysql: app_conns=2 running=0
capacity-api: CPU=143.83%  mysql-db: CPU=36.56%   mysql: app_conns=2 running=0
capacity-api: CPU=144.79%  mysql-db: CPU=36.60%   mysql: app_conns=2 running=0
capacity-api: CPU=143.67%  mysql-db: CPU=38.42%   mysql: app_conns=2 running=0
```

Pool utilization is now `L = λ·W_db` = 4,247 × 0.000074 s = **0.31 of 2
connections = 15.7%**. The pool never became binding. The constraint is still
API-process CPU; **the ceiling simply rose ~125×**. What changed is which term
dominates it:

| | fixed overhead | bytes | rows |
|---|---:|---:|---:|
| before | 0.5% | 58.2% | 41.4% |
| after projection | 0.7% | 37.3% | 62.0% |
| after pagination | **59.1%** | 15.2% | 25.8% |

The endpoint is now **overhead-bound** (HTTP parsing, Express routing,
prom-client histogram observation) rather than payload-bound — which is the
normal, healthy state for a small JSON API. Fixed overhead alone implies a
ceiling of 7,192 req/s; the measured 4,247 falls short of that, consistent with
k6 and five containers sharing this laptop's CPUs. **I did not decompose that
gap further — isolating host contention needs a separate load-generator machine.
Recorded as a limit of the rig, not a property of the service.**

**Honest note on the 3-term model** (`c + a·bytes + b·rows`, in
[`model-correction.txt`](evidence/OPS-2201/model-correction.txt)): it reproduces
all three measurements with 0.0% error, but that is **interpolation, not
validation** — three parameters fitted to three points. It earns no predictive
credit until tested against a fourth point it has not seen.

#### Blast radius, re-tested → [`evidence/OPS-2201/fixC-blast-radius.txt`](evidence/OPS-2201/fixC-blast-radius.txt)

The original diagnosis said the search storm was starving *every* endpoint. If
that was right, fixing search must also fix the bystander. Re-probing
`/api/patients/recent` during an identical 200-VU search load:

| | before fixes | after fixes | idle |
|---|---:|---:|---:|
| `/api/patients/recent` | 5.590 / 5.804 / 5.783 s | **0.047 / 0.048 / 0.046 / 0.044 / 0.044 s** | 0.003 s |

**122× recovery on an endpoint I never modified.** This is the load-bearing
confirmation of the whole diagnosis: the mechanism was shared-resource
starvation, not anything specific to the search query. It remains ~15× slower
than idle, which is ordinary queueing at a saturated 200-VU offered load, not a
defect.

#### Summary — before → after

| Metric | before | after | factor | vs. noise floor |
|---|---:|---:|---:|---|
| **Throughput** | 34.09 req/s | **4,247 req/s** | **124.6×** | RPS noise ±1% — overwhelming signal |
| **p95** | 6.72–7.04 s | **52.67–58.59 ms** | **~124×** | far outside ±25% admissible band ✅ |
| **Error rate** | 0.00% | 0.00% | — | unchanged; never the symptom |
| **Peak RSS** | 148.7 MiB (93%) | **46.5 MiB (29%)** | 3.2× headroom | memory noise <2% ✅ |
| **Rows examined/req** | 100,000 | **50** | **2,000×** | mechanism counter |
| **Payload** | 3.47 MiB | 7.4 KiB | **477×** | mechanism counter |
| **Bystander `/recent`** | 5.78 s | **0.045 s** | **~128×** | blast radius resolved |

SLO check: **p95 < 200 ms ✅** (was 6.72 s ✗), **error rate < 1% ✅**,
**RPS floor ≥ 49.5 ✅** (4,247).

**Prediction scorecard: 1 of 3 correct.** Step A confirmed exactly; Step B
missed high (bytes-only model); Step C wrong on mechanism (predicted the
constraint would leave the event loop; it did not). The forward-modelling
discipline still paid off — each miss identified a *specific missing term*
(per-row cost, then fixed per-request overhead) rather than leaving me to
rationalize the result afterwards.

**Trade-offs introduced by these fixes — every fix has a bill:**

- **Index:** ~1–2 MB for the B-tree on a 10-value column, plus write
  amplification — every `INSERT`/`UPDATE`/`DELETE` on `patients` now maintains a
  second index. On a 10-distinct-value column this index is nearly useless for
  selectivity (10% of the table per lookup); it earns its keep only because it
  converts a scan into a range read. **If admissions write heavily to
  `patients`, this index is a real ongoing cost for a modest read win** — it is
  the most questionable of the three changes, and I would revisit it if write
  volume grew.
- **Projection:** `notes` is no longer returned by search. Any client that
  displayed clinical notes directly from the search result list would break.
  Verified `/api/patients/export` is unaffected (separate handler + SQL). A
  detail view fetching one patient by id is the correct place for `notes`.
- **Pagination:** a real API contract change. Callers that relied on receiving
  all 10,000 matches now silently get 50 unless they page. `OFFSET` also
  degrades on deep pages — MySQL still walks and discards the skipped rows, so
  `OFFSET 9000` re-introduces a scan-like cost. **Keyset pagination
  (`WHERE id > :last_id`) would avoid that** and is the right follow-up if deep
  paging is ever used in anger.
- **Not addressed:** search is still `O(rows matching)` at the DB layer for
  counting purposes, and there is no total-count endpoint. A UI wanting "10,000
  results" would need a separate `COUNT(*)`, which re-introduces the scan-shaped
  cost. Flagged, not fixed.

---

## Investigation — OPS-2202
*Ticket:* [Whole app freezes during surges, DB looks idle](./incidents/OPS-2202.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2202.js`

### P3 — OUT-OF-SAMPLE TEST of the OPS-2201 cost model (registered before any change)

The 3-term model from OPS-2201 (`js_ms = 0.1391 + 4.692 ns/byte + 1.213 µs/row`)
fits its three measurements at **0.0% error — which is interpolation, not
validation**: three parameters fitted to three points can do nothing else. It has
earned no predictive credit. OPS-2202 raises the connection pool, which gives a
free out-of-sample point, and I am recording the prediction **before touching
the pool** so it cannot be retrofitted.

**Prediction P3a — raising the pool will NOT change search throughput.**
Post-fix search runs at 4,247 req/s with the pool at **15.7% utilization**
(`L = λ·W_db` = 4,247 × 0.074 ms = 0.31 of 2 connections). The model says search
is bound by API-process CPU, not by connections. Raising the pool 2 → N moves
the pool ceiling from 27,027 req/s to something even more irrelevant.

> **Predicted: search throughput after the pool raise = 4,247 req/s ± 5%
> (i.e. 4,035 – 4,459), unchanged.**
> **Falsifier:** search throughput rises by more than 10%. That would mean the
> pool *was* partially binding at 4,247 req/s and my constraint attribution —
> the core claim of OPS-2201 — is wrong.

**Prediction P3b — a genuinely unseen payload size.** P3a tests the *constraint
attribution*; it does not test the model's *coefficients*, since it predicts
"no change." So a second, cheap out-of-sample point: re-run search at
`limit=200` (`MAX_PAGE_SIZE`), a row count and byte count the model has never
seen.

```
rows  = 200
bytes = 200 x 155.3 B = 31,060 B
js_ms = 0.1391 + (4.692e-6 x 31060) + (1.213e-3 x 200)
      = 0.1391 + 0.1457 + 0.2426 = 0.5274 ms
model ceiling = 1 / 0.5274 ms = 1,896 req/s
```

The model's ceiling overshoots achieved throughput because k6 and five
containers share this host: at `limit=50` it predicted 7,192 and 4,247 was
achieved, a realization factor of **0.591**. Applying it:

> **Predicted: `limit=200` throughput = 1,896 × 0.591 = ~1,120 req/s.**
> **Tolerance ±20%: 896 – 1,344 req/s.**
> **Falsifier:** anything outside that band. If it lands high, the per-row term
> is overstated; if low, there is a term I have not identified (most likely
> non-linear GC pressure as payloads grow).

Both are scored in the OPS-2202 write-up **whether they hit or miss**. If P3b
lands in band, the model has survived a point it was not fitted to and stops
being interpolation. If it misses, the miss names the missing term — which is
worth more than the fit was.

### Hypothesis
> Given the query is trivial and the DB is idle yet requests pile up, I think
> the bottleneck is ________________________________________________________
> because __________________________________________________________________.

### Observation (evidence)
> Where is time spent between request arrival and query execution? Capture the
> error codes and any queue/timeout evidence from logs and metrics:
> ```
>
> ```
| Metric                    | Value | vs. baseline |
|---------------------------|-------|--------------|
| Successful RPS (plateau)  |       |              |
| p95 / p99 latency         |       |              |
| Error / timeout rate      |       |              |
| Avg service time per query (s) |  |              |

### Root cause & mechanism
> Explain the paradox: idle database, trivial query, stalled app. What finite
> resource is being contended, and where does it live? Derive the *right* size
> for that resource from your measured throughput and service time (state the
> relationship you used):
> - Measured avg service time W = ______ s
> - Target throughput λ = ______ req/s
> - Required capacity = ______  (show your working)
> Why does making it arbitrarily large eventually stop helping? ______________

### Fix & verify
> The change you made: ______________________________________________________
> New RPS: ______  New error rate: ______  New p95: ______
> What upstream protection would make a burst degrade gracefully instead of
> collapsing? _______________________________________________________________

---

## Investigation — OPS-2203
*Ticket:* [Bed admissions fail with DB errors under load](./incidents/OPS-2203.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2203.js`

### Hypothesis
> Given one-at-a-time works but concurrent admits to the *same* hospital fail,
> I think the cause is _____________________________________________________
> and the failure will show up as ______ (a DB error? a timeout? a stall?) ___.

### Observation (evidence)
> While the reproduction runs, inspect concurrent writers to one row:
> ```sql
> SELECT * FROM performance_schema.data_locks\G
> SELECT * FROM sys.innodb_lock_waits\G
> SHOW ENGINE INNODB STATUS\G   -- TRANSACTIONS section
> ```
> Paste the most telling waiter/blocker rows and the failure signature you saw
> (a DB error + code, a timeout, or stalled/near-zero throughput):
> ```
>
> ```
| Metric                     | Value | vs. baseline |
|----------------------------|-------|--------------|
| p95 / p99 latency          |       |              |
| Max successful admits/sec  |       |              |
| DB error(s) + code         |       |              |
| Error rate                 |       |              |

### Root cause & mechanism
> Explain why concurrency cannot beat serialization on a single hot row. If the
> critical section is held for W seconds per admit, what is the theoretical max
> throughput for that one row, regardless of how many callers pile on?
> 1 / W = ______ admits/sec. Where does the time in the critical section go, and
> which of the transactional guarantees is enforcing the wait? ________________

### Fix & verify
> The change you made (consider: shrinking the critical section, moving slow
> work out of the transaction, atomic guarded updates, reducing contention on
> the hot row): _____________________________________________________________
> Re-measured throughput / error rate: ______________________________________

---

## Investigation — OPS-2204
*Ticket:* [Nightly export crashes the service repeatedly](./incidents/OPS-2204.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2204.js`

### Hypothesis
> Given memory spikes right before each restart and only the big export is
> affected, I think the cause is ___________________________________________
> because __________________________________________________________________.

### Observation (evidence)
> Watch `nodejs_heap_size_used_bytes`, GC pauses, and restarts:
> ```bash
> docker stats
> docker compose logs -f capacity-api
> ```
| Metric                          | Value |
|---------------------------------|-------|
| Approx. payload size per request|       |
| Peak heap before crash          |       |
| Time-to-first-crash             |       |
| Container restart count         |       |
| GC pause trend                  |       |

> Paste the crash / exit log lines:
> ```
>
> ```

### Root cause & mechanism
> Estimate per-row size, then the full payload: rows × bytes/row = ______ MB.
> With C concurrent callers, peak resident memory ≈ ______ MB — compare to the
> container's memory budget (160MB locally / 256MB in prod). Explain what happens
> to GC frequency, CPU, and
> throughput as live heap approaches the limit, and why the current approach
> uses O(N) memory while a better one could use far less. ____________________

### Fix & verify
> The change you made (consider: bounding how much of the result set is in
> memory at once, streaming to the response, sensible page sizes, compression):
> ____________________________________________________________________________
> Re-run evidence — new peak heap: ______  restarts: ______  error rate: ______

---

## Post-incident review (synthesis)

### Running theme — prediction scorecard across all incidents

Kept here rather than buried in each incident, because the *pattern of misses*
is more informative than any individual result. Updated as each incident closes.

| # | Prediction (made before measuring) | Outcome | What the miss taught |
|---|---|---|---|
| 2201-A | Index will not change throughput (~34.5 req/s) | ✅ **Hit** — 34.64 | Constraint attribution was right |
| 2201-B | Projection → 65–75 req/s | ❌ **Missed high** — 51.13 | Cost is not bytes-only; there is a **per-row** term (1.21 µs/row) that dropping columns cannot touch |
| 2201-C | Constraint leaves the event loop; several hundred req/s | ❌ **Wrong on mechanism** — 4,247 req/s, still event-loop bound | There is a **fixed per-request** term (0.139 ms) — and a 125× ceiling rise need not move the constraint |
| P3a | Pool raise won't change search throughput | ⏳ pending 2202 | — |
| P3b | `limit=200` → ~1,120 req/s (±20%) | ⏳ pending 2202 | first genuine out-of-sample test of the cost model |
| P1 | 2203 is not a lock-timeout incident; near-zero 1205s | ⏳ pending 2203 | — |
| P1-corollary | Fixing 2202's pool will *create* 1205s in 2203 | ⏳ pending 2203 | — |
| P2 | 2204 OOMs at 2–3 concurrent exports; exit 137 | ⏳ pending 2204 | — |

**The generalizable lesson, from OPS-2201's three-in-a-row:**

> **Fixing the binding constraint does not necessarily move the constraint —
> and you cannot know whether it did without measuring afterwards.**

All three OPS-2201 misses share one shape: I was reasoning about *ceilings*
while the *binding constraint stayed put*. Step C is the sharpest version — the
ceiling rose **125×** and the constrained resource (API-process CPU) **never
changed**. The intuition that "a big improvement means the bottleneck moved" is
simply false; a bottleneck can be relieved by two orders of magnitude and still
be the bottleneck. The corollary for capacity work is practical:

- **Naming a ceiling is cheap; naming the *binding* one requires measurement**
  of what is actually saturated, at the time it is saturated.
- **A fix that moves a non-binding ceiling produces no observable change and is
  still correct work** (2201-A: the DB got 2.5× faster, users saw nothing). It
  buys headroom that becomes load-bearing only once something else is fixed.
- **Therefore: re-measure which resource is saturated after every fix**, not
  just whether the numbers improved. "It got faster" does not tell you what to
  fix next; "CPU is still pinned while the pool sits at 15.7%" does.

> Rank the four incidents by **blast radius** (threat to overall availability at
> scale), justified with your measured numbers:
> 1. ____________________________________________________________________
> 2. ____________________________________________________________________
> 3. ____________________________________________________________________
> 4. ____________________________________________________________________
>
> If you could ship only **one** fix before a launch, which and why?
> ____________________________________________________________________________
>
> For each incident, what alert or dashboard would have caught it in production
> *before* a user filed a ticket? ____________________________________________

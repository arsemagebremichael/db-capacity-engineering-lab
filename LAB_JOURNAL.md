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

**How I will read every later result, given this noise floor:**

- **RPS is trustworthy to ~1%.** A throughput change of any real size is signal.
- **p50 is trustworthy to ~16%.** Treat < 20% p50 moves as noise.
- **p95 is trustworthy only to ~25%.** A "20% p95 improvement" from a fix would be
  *indistinguishable from noise* and I will not claim one.
- **p99 and max are nearly worthless at this sample size** (99% and 155% spread,
  driven by single-request outliers over only 1500 samples). I will report them
  but will not base any conclusion on a p99 delta smaller than ~2×.
- **Memory is rock-solid (< 2%).** Heap/RSS deltas are highly trustworthy — which
  matters for OPS-2204.

Because the incident fixes are expected to produce order-of-magnitude changes
(not 20% ones), this noise floor is acceptable. Where a result lands inside the
noise band, I say so explicitly rather than claiming a win.

> **SLOs I'll hold the incidents to** (derived from the measured healthy system,
> not invented): **p95 < 200 ms** (the threshold `00-baseline.js` already encodes,
> and ~10× the measured healthy p95 of 19.3 ms — generous headroom);
> **error rate < 1%**; **RPS floor ≥ 49.5 req/s** for the offered load of 50 VUs
> at 1 req/s/VU (i.e. the system must not drop requests it was offered).

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
4. Each endpoint's ceiling, before any queueing: `1/W` = 730 req/s (`recent`),
   21.6 req/s (`search`), **1.97 req/s** (`admit`), 1.83 req/s (`export`).

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
> ____________________________________________________________________________
> because __________________________________________________________________.

### Observation (evidence)
> Investigate how the database executes the search. Paste what you find:
> ```
>
> ```
| Metric (under load) | Value | vs. baseline |
|---------------------|-------|--------------|
| p95 latency         |       |              |
| RPS                 |       |              |
| Error rate          |       |              |
| Rows examined / req |       |              |

### Root cause & mechanism
> What is the database doing per request, and why does cost blow up with data
> size and concurrency? Name the mechanism and the data structure involved.
> Estimate the cost difference between the current behaviour and the ideal one
> for ~100,000 rows. _________________________________________________________

### Fix & verify
> The change you made (be specific): ________________________________________
> Re-run evidence — new query behaviour: ____________________________________
> New p95: ______  New RPS: ______  Improvement factor: ______×
> Any trade-off introduced by your fix? ______________________________________

---

## Investigation — OPS-2202
*Ticket:* [Whole app freezes during surges, DB looks idle](./incidents/OPS-2202.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2202.js`

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

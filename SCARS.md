# 🩹 Scar Log — Regional Health on-call lab

Read this at 2am. Every number here was measured; raw output is in
[`evidence/`](./evidence/). Full working in [`LAB_JOURNAL.md`](./LAB_JOURNAL.md).

**Scope:** all four incidents — OPS-2201, OPS-2202, OPS-2203 and OPS-2204 —
were investigated, fixed and verified. Scar OPS-2202-R records a regression this
submission introduced; scar **OPS-2203** records the fix that closed it.

> ⚠️ **Read scar OPS-2202-R first if you are deploying this.** It documents a
> live regression introduced by a fix in this submission: `ER_LOCK_WAIT_TIMEOUT`
> errors on `/admit` that did not exist before, 88 versus 0. Documented, not
> fixed, with a recommended revert.

---

## OPS-2201 — Patient search slow at shift change

- **S — Symptom:** `GET /api/patients/search` at 200 concurrent users: **p95 6.72–7.04 s** against a **19.30 ms** baseline, throughput flat at **34.09 req/s**, **0.00% errors**. The reporter said the "recent patients" panel stayed fast; probing it during the storm measured **5.590 / 5.804 / 5.783 s** versus **0.0043 s** idle — a **~1,400× degradation at HTTP 200**. The whole service was down, not just search.
- **C — Cause:** Node's **single JS thread**, saturated by serializing an oversized result set. `Smith` matches **10,000 of 100,000** rows (10 distinct last names), and `SELECT *` shipped all of them with a 180-char `notes` TEXT column = **3.47 MiB per response**. Cost per request on the one thread: **28.9 ms** (1.21 µs/row materializing 10,000 row objects + 4.69 ns/byte to `JSON.stringify` and write). Event-loop ceiling `1/28.9 ms` = **34.5 req/s**; observed **34.55**. The missing index on `patients(last_name)` was real — **100,000 rows examined for 10,000 returned, 10:1** — but its ceiling (`pool/W_db` = 2/20.25 ms = **98.8 req/s**) was never the binding one.
- **A — Action:** Three separate commits, one mechanism each. (1) `CREATE INDEX idx_patients_last_name`. (2) Drop `notes` from the search projection. (3) `LIMIT 50 OFFSET ?` paging, max 200.
- **R — Result:**

  | | before | after | factor |
  |---|---:|---:|---:|
  | Throughput | 34.09 req/s | **4,247 req/s** | **124.6×** |
  | p95 | 6.72–7.04 s | 52.67–58.59 ms | ~124× |
  | Rows examined/req | 100,000 | 50 | 2,000× |
  | Payload | 3.47 MiB | 7.4 KiB | 477× |
  | Peak RSS | 148.7 MiB (93% of cap) | 46.5 MiB (29%) | 3.2× headroom |
  | Bystander `/recent` | 5.78 s | 0.045 s | ~128× |

  Errors were 0.00% before **and** after — they were never the symptom.
- **Scar / lesson:** **The index made the database 2.5× faster (20.25 → 8.1 ms) and users saw nothing — throughput moved +1.6%, inside run variance.** The 124.6× came from changing *what the application ships*, not from the fix the ticket implied. A fix can be correct, verifiable, and completely invisible, because it lowered a ceiling that wasn't binding.
  **Alert that would have caught it:** not error rate (0.00%) and not DB health (MySQL at 68–74% CPU with 65% of its pool idle — genuinely green). It needed **p95 across every route, not just the one in the ticket** — the bystander endpoint degraded 1,400× and nobody filed a ticket about it.
- **Evidence:** [`evidence/OPS-2201/`](./evidence/OPS-2201/) — `explain-analyze-before.txt`, `perf-schema-digest.txt`, `under-load-saturation.txt`, `fixA-index.txt`, `fixB-projection.txt`, `fixC-pagination.txt`, `fixC-blast-radius.txt`, `capacity-math.txt`. Commits `7088b9e`, `7a59d1f`, `3147fc6`.

---

## OPS-2202 — App freezes during registration surges, DB looks idle

- **S — Symptom:** 2,000 concurrent users on the trivial `GET /api/patients/recent`: **p95 696 ms** against a 19.30 ms baseline (**36×**), throughput plateaued at **3,391 req/s**, **0.00% errors — 0 of 103,760 requests**, all HTTP 200. The reporter's "returns 500s" **did not reproduce**. `db_errors_total` never created a series.
- **C — Cause:** The same **single JS thread**, at **0.295 ms/request** ⇒ ceiling **3,391 req/s**. Observed 3,391.6. The database was genuinely idle — **21% CPU**, and its pool ran at **9.0% utilization** (`L = λ·W_db` = 3,391.6 × 0.0531 ms = **0.18 of 2 connections**; `Max_used_connections` never exceeded 3). `nodejs_active_handles{type="Socket"}` = **2,005**: every request was accepted and queued *inside the process*. Little's Law places the queue exactly: `W = 2,000/3,391.6` = **0.590 s** predicted vs **0.536 s** measured.
- **A — Action:** (1) Pool `connectionLimit` 2 → 25 — shipped as a **documented no-op**, sized for the admit path (`W = 508 ms` ⇒ 3.9 admits/s), not for this incident. (2) **Admission control**: bounded in-flight at **`MAX_INFLIGHT=32`** with immediate `503 + Retry-After`, `/health` and `/metrics` exempt. (3) Optional clustering, **default off**.
- **R — Result:**

  | | no admission control | `MAX_INFLIGHT=32` |
  |---|---:|---:|
  | Requests served OK | 3,448 req/s | **627 req/s** (−82%) |
  | Served-request p95 | 963 ms | **198 ms** (inside the 200 ms SLO) |
  | Error rate | 0.00% | **93.6%** |
  | Visible to error-rate alerting | **no** | **yes** |

  Pool raise: 3,412 → 3,447 req/s, **+1.0%** — no-op, as predicted.
  Clustering: 1→2 workers **1.48×** (4,991 req/s), then **negative** — 3 workers **0.73×**, 4 workers **0.50×**, as RSS hit **154.2 and 159.3 MiB of the 160 MiB cap** and CPU *fell* from 1.50 to 0.63 cores because the process moved into GC.
- **Scar / lesson:** Three lessons, in order of how much they cost me.
  1. **The detector I recommended after OPS-2201 was wrong.** I nominated `nodejs_eventloop_lag_p99_seconds`; here it sat at **10–14 ms, indistinguishable from idle**, through a 36× brownout with the same root cause. It samples **per-turn delay, not queue depth** — 2201's 29 ms callbacks moved it, 2202's 0.3 ms callbacks don't, even with 2,000 requests queued. **A detector validated on one incident is validated on one point.**
  2. **Rejection is not free.** Each 503 costs **~0.089 ms of the same scarce thread**, and k6 doesn't back off, so a tight limit becomes a rejection storm: at N=64, **86% of the thread budget went to saying "no"** (452 × 0.295 ms + 9,641 × 0.089 ms = 0.99 core-s). In-process shedding is the **weakest** place to shed; the edge is better.
  3. **Clustering is bounded by memory, not cores, in a 160 MB container.** Four workers are half as fast as one.
  **Alert that would have caught it:** **`http_requests_in_flight > 2× steady-state`** — a direct read on queue depth (steady state here is <1, incident value 2,005). Backed by per-route p95. Error rate, DB health, and the incident's own shipped `http_req_failed` gate were all blind — that gate **passed** during the brownout.
- **Evidence:** [`evidence/OPS-2202/`](./evidence/OPS-2202/) — `k6-before.txt`, `under-load.txt`, `fix1-pool-AB.txt`, `fix2-admission-control.txt`, `fix2-inflight-sweep.txt`, `fix3-clustering.txt`, `P3b-out-of-sample.txt`.

---

## The scar that isn't an incident — two experiments that lied

Both produced clean-looking tables while measuring nothing.

1. **The instrument contended with the subject.** Polling `/metrics` once a second from the harness to sample heap inflated p99 to **296 ms** versus 16–17 ms p95 in identical unsampled runs. Discarded; peak heap now comes from Prometheus's existing 5 s scrape, which costs nothing extra.
2. **The treatment never reached the patient.** `VAR=x docker compose up` does **not** inject env into a container unless the compose file declares it, so a pool A/B and a full `MAX_INFLIGHT` sweep silently ran **every arm at the default**. Caught only by an impossibility: a **4,096** in-flight limit reported shedding **93.5%** of **2,000** offered VUs — a limit above the offered concurrency can reject nothing.

**Lesson: verify the treatment landed before trusting any arm.** Had the bogus numbers been merely plausible instead of impossible, I'd have published the right conclusion from a broken experiment — which is worse than being wrong, because nothing prompts a recheck.

---

## ⚠️ OPS-2202-R — My own fix introduced a regression (found, not fixed)

**This is a scar from shipped work, not from the original system.**

- **S — Symptom:** `POST /api/hospitals/:id/admit` under 500 concurrent admits to one hospital returns **88 HTTP 500s carrying `ER_LOCK_WAIT_TIMEOUT` (MySQL 1205)**. At the pre-change pool size these errors are **zero**. Successful admits also *fell*: **82 → 67**.
- **C — Cause:** **The pool of 2 was not undersized — it was rationing access to a serialized resource.** Admits to one hospital row serialize on an InnoDB X row lock held for the whole transaction, including the 500 ms `notifyBedRegistry` call inside it ([`api/server.js:230`](./api/server.js#L230), inside the transaction spanning [`215-243`](./api/server.js#L215-L243)). Single-row throughput is `1/W_lock` ≈ **2 admits/s regardless of pool size** — extra connections buy *waiters*, not throughput. Raising the pool to 25 put **25 transactions on one row, 24 of them WAITING behind 1 holder** (`performance_schema.data_locks`), so the last waiter's wait `(N−1) × 0.5 s` = 12 s exceeded the 5 s `innodb-lock-wait-timeout`. `Innodb_row_lock_time_avg` measured **5,276 ms** — pinned at the timeout. **Queueing became failing.**
- **A — Action:** **None. This is documented, not fixed.** A fix could not be verified within the deadline, and shipping an unverified fix is what this lab spent two incidents learning not to do.
- **R — Result:** Regression confirmed with a control arm (pool=2 → **0** timeouts; pool=25 → **88**), which is what makes it causal rather than correlational. Crossover arithmetic: `(N−1) × 0.5 s < 5 s` ⇒ **N ≤ 10 safe, crossover at N ≈ 11.** **Values between 3 and 10 were not measured** — the bound is arithmetic plus two endpoints.
- **Scar / lesson:** **A change measured as a no-op on one endpoint was a regression on another.** The pool raise was verified against `/recent` and `/search` (+1.0%, −0.1%) and shipped on that evidence. It was never measured against the endpoint whose service time is **958× larger** (508.86 ms vs 0.531 ms) — and that is the only endpoint where pool size could possibly matter, since `N = λ·W` scales with W. **The endpoint I used to justify the change (admit) is the one I did not test it on.** Verify a shared-resource change against the endpoint with the *longest* hold time, not the most traffic.
  **Alert that would have caught it:** `db_errors_total{code="ER_LOCK_WAIT_TIMEOUT"} > 0` — it fires cleanly here and would have fired on the first deploy. Notably this is the *only* incident in this lab where error-rate alerting works, because it is the only one where the system fails rather than degrades.
- **Evidence:** [`evidence/OPS-2203-partial/`](./evidence/OPS-2203-partial/) — `k6-pool25.txt`, `k6-pool2-control.txt`, `innodb-status.txt` (TRANSACTIONS verbatim), `error-code-breakdown.txt`.

> **✅ RESOLVED — and NOT by reverting.** The revert to `MYSQL_POOL_SIZE=8` was
> recommended here and **was not carried out, because it treated the symptom.**
> The 500 ms `notifyBedRegistry` call was moved out of the transaction instead
> (`d10f8b6`), which shrank the critical section **508.86 ms → 0.690 ms** and
> took timeouts **89 → 0 at the unchanged pool of 25**, while admits rose
> **2.30 → 19.80/s**. The pool raise needed no revert: it was never the defect,
> only the thing that exposed it. See scar **OPS-2203** below.

---

## ✅ OPS-2203 — 500 ms of network call inside a row lock

- **S — Symptom:** `POST /api/hospitals/:id/admit`, 500 concurrent admits to one hospital: **89 HTTP 500s carrying `ER_LOCK_WAIT_TIMEOUT` (MySQL 1205)**, only **69** admits succeeding — **2.30 admits/s**. Served requests took **p95 10.06 s**. The endpoint's own k6 gate, `p(95)<1000`, **PASSED at 42.49 ms** while 99.98% of requests failed.
- **C — Cause:** The bed-count `UPDATE` takes an InnoDB **X row lock held until `COMMIT`**, and a **500 ms `notifyBedRegistry` network call sat inside that window** ([`api/server.js:230`](./api/server.js#L230), txn spanning [`215-243`](./api/server.js#L215-L243)). Every concurrent admit to the same hospital serialized on it, so single-row throughput was `1/W_lock` ≈ **2 admits/s regardless of pool size**. At the pool of 25, `data_locks` showed **1 holder + 24 waiters**; the deepest wait `24 × 0.5 s = 12 s` exceeded the 5 s `innodb_lock_wait_timeout`. **Queueing became failing.**
- **A — Action:** Moved `notifyBedRegistry` **after `COMMIT` and after the connection is released** (`d10f8b6`), so it holds neither the row lock nor a pool connection. One concern, one commit. **The pool was NOT changed** — it stayed at 25.
- **R — Result:** **`ER_LOCK_WAIT_TIMEOUT` 89 → 0** (the `db_errors_total` series no longer exists). Admits **69 → 594** (**8.61×**), **2.30 → 19.80 admits/s**. Served p95 **10.06 s → 2.39 s** (−76%, outside the ±25% admissible band). Critical section **508.86 ms → 0.690 ms** measured. Reproduced: a second run gave 607 admits vs 594, 2.2% apart.
- **Scar / lesson — the one worth reading at 2am: QUEUEING BECAME FAILING, and the fix made it queueing again.** That is the whole incident in one line. The fix did **not** remove the serialization and did **not** empty the queue — **20 row-lock waiters remain after it, against 24 before.** It moved the queue depth back under the timeout. Admits to one hospital row still serialize, still wait, and still form exactly the same queue; they just no longer sit in it for longer than 5 s. If you take one thing from this scar, take that the goal was never "remove the lock" — it was **get the wait under the timeout**, and the lever for that is the length of the critical section, not the size of any pool. More importantly, **the critical section still contains something that is not database work: event-loop lag.** Under load `nodejs_eventloop_lag_mean` goes 12.1 → 29.4 ms, and the transaction awaits twice after `BEGIN`, so the lock is held for `UPDATE + lag + COMMIT + lag` ≈ **50 ms**, not the 0.690 ms measured on an idle loop — a **73× inflation**, confirmed two ways (derived from throughput, and by a probe connection in a *separate, unsaturated* node process that saw only 0.94 ms — **a control I got by luck, not design**: I used `docker compose exec ... node -e` because it was the fastest way to get a connection, not realising it spawns a process with its own idle event loop. Run inside the API process it would have paid the same lag and I would have concluded the database was slow).
  **The database was never degraded, at any point in this incident** — 0.94 ms under full load against 0.690 ms idle. Worth saying plainly because **the ticket blamed the database and the error code corroborated it**: MySQL reported a genuine 1205, accurately, about a lock that *Node* was holding open. The database was the messenger for all four incidents in this lab and the culprit in none of them. **The effective crossover is therefore N ≈ 100, not the ≈ 7,250 the idle number predicts.** Pool 25 is safe with a **4.1× margin, not 290×.**
  **And the loop is saturated by 466k shed requests per run — which OPS-2202's own admission control generates. One incident's fix is inside another incident's critical section.**
  **The margin is now load-dependent, which the old bug was not.** Before the fix the crossover was set by a constant (a hardcoded 500 ms sleep). Now it is set by event-loop lag, which grows with traffic: `N ~= 1 + 5000/(0.7 + 2 x lag_ms)` gives N ~= 200 at idle lag, ~100 at the 29 ms measured here, and **~25 at 104 ms — where pool 25 starts timing out again with nobody touching a config file.** **Watch `nodejs_eventloop_lag_mean_seconds` > 50 ms on the admit path.** The fix bought headroom, not immunity.
  **Rule this cost me:** *any duration used in a capacity prediction must be measured under the load the prediction is about.* The 0.690 ms was honest, reproducible, and irrelevant — it made two pre-registered predictions (P4a, P4c) miss by 72× and 3.2×.
  **Alert that would have caught it:** `db_errors_total{code="ER_LOCK_WAIT_TIMEOUT"} > 0`. **The alert that would NOT:** the shipped `p(95)<1000` gate, which was pushed the *right way* by the failure — 450k shed requests returning in ~0.5 ms drag the aggregate p95 down, so the worse the incident got, the healthier the gate looked. **Never gate on an aggregate over mixed outcomes.**
- **Evidence:** [`evidence/OPS-2203/`](./evidence/OPS-2203/) — `k6-before.txt`, `k6-after.txt`, `innodb-status-before.txt` / `-after.txt` (TRANSACTIONS verbatim), `error-code-breakdown.txt` / `-after.txt`, `under-load-mechanism.txt`. Predictions pre-registered in `f8a27de` **before** the fix and scored in [`LAB_JOURNAL.md`](./LAB_JOURNAL.md): **2 hits, 1 split, 2 misses.**

---

## ✅ OPS-2204 — An unbounded export held two full copies of the table

- **S — Symptom:** the nightly ETL job (50 concurrent callers of `GET /api/patients/export`) **killed the service repeatedly** — `RestartCount` **0 → 10 in 121 s**, `ExitCode=137`, `OOMKilled=true`. k6 saw **1,200,251 requests, ZERO successes, `data_received = 0 B`**, 96.28% `connection refused`. **This was not a brownout, it was an outage** — the process was absent, not slow. It recovered on its own once load stopped.
- **C — Cause:** `SELECT * FROM patients` was materialized into an array and then `res.json()`'d, holding **two full copies at once** — 100,000 row objects *and* the 34.47 MiB string `JSON.stringify` built from them. **One export cost ~89 MiB of RSS against a 160 MiB cgroup.** Measured threshold: 1 concurrent survives, 2 survives at 83% of cap, **3 dies**. `NODE_OPTIONS=--max-old-space-size=256` lets V8 over-commit past the 160 MiB container, so the **kernel** wins the kill — 10 of 11 deaths were cgroup SIGKILLs, 1 was V8's own heap limit.
- **A — Action:** stream the result set (`c87b91c`). Rows are read one at a time via mysql2 `.stream()` and written straight to the socket with `res.write()` backpressure honoured, so peak memory is O(one row + socket buffer) instead of O(result set). `count` is fetched first inside a REPEATABLE READ consistent snapshot so the response stays **byte-identical** and the count cannot disagree with the rows.
- **R — Result:** **`RestartCount` 10 → 0** over the identical 2-minute run. Per-export RSS delta **+89 MiB → +2.52 MiB (35× less)**. Death threshold **3 → survives all 32** the shedder admits. Successful exports **0 → 356**, `data_received` **0 B → 13 GB**. Payload byte-identical (36,141,185 bytes) and *faster* uncontended (0.591 → 0.377 s).
- **Scar / lesson — the pool cannot bound memory, and it never could.** The tempting reasoning is "pool of 25 ⇒ at most 25 concurrent exports ⇒ bounded." It is wrong, and the service dying at **3** while the pool sat at 25 proves it: `pool.query()` releases the connection when it **resolves**, which is *before* the expensive part — the rows are already resident and the serialization happens afterwards holding no connection at all. **A connection pool serializes query execution; it does not serialize memory residency.** If you want to bound memory, bound the *result set*, not the connections.
  **The second lesson is worse, because nobody did anything to cause it: `MAX_INFLIGHT=32` was UNCHANGED across this fix and its value inverted.** Before, 32 concurrent exports needed ~2,850 MiB against a 160 MiB cap — the admission control was 16× more permissive than survivable and offered **no protection whatsoever** while appearing to be a safety limit. After, the same 32 needs ~115 MiB and is exactly what holds the storm alive. **A correctly configured limit is not a property of the limit — it is a property of the limit AND the cost of the work behind it.** A number that was right yesterday is wrong the moment an endpoint's cost changes, and nothing in the system will tell you.
  **Margin, stated rather than celebrated:** the storm still peaks at **141.3 MiB of 160 — 88%.** At ~3.6 MiB per concurrent stream over a ~27 MiB baseline, safe concurrency is ~37 against a configured 32: a **1.16× margin**. Raising `MAX_INFLIGHT` past ~36 brings the OOM back, and so does growing the average row — which is the exact thing the ticket says keeps happening. **Watch `process_resident_memory_bytes` > 140 MiB, and treat `MAX_INFLIGHT` as coupled to row width.** Not attempted: a per-route concurrency cap for this endpoint, which is what would actually decouple it.
  **Alert that would have caught it:** container `RestartCount` climbing, or `State.ExitCode=137`. **Note what would NOT: any in-process metric.** The process was SIGKILLed, so `db_errors_total`, per-route p95 and `http_requests_in_flight` all reported *nothing* — there were no requests to observe. **The only witness to a process being killed is outside the process.**
- **Evidence:** [`evidence/OPS-2204/`](./evidence/OPS-2204/) — `k6-before.txt` (with the aggregated failure breakdown), `k6-after.txt`, `restart-storm-timeline.txt` (per-2s RestartCount/ExitCode/OOMKilled), `concurrency-sweep.txt` / `-after.txt`, `service-time-1vu-export.txt`. Predictions P2 and P7a–e pre-registered before the fix and scored: **P2 hit; P7 3 hits, 1 miss (P7d, both parts).**

---

## What remains unmeasured

All four incidents are investigated, fixed and verified. These are the gaps that
remain, listed so they are not mistaken for things that were checked.

**OPS-2203 — the failure signature at the original pool of 2.** P1 predicted an
app-side pool-queue stall rather than a database error, and was scored **wrong**
on its main claim. The control arm shows zero DB errors at pool 2, consistent
with half of P1, but queue latency, offered-vs-served rate and the throughput
ceiling at pool 2 were **never characterised**.

**OPS-2203 — blast radius.** No bystander route was probed during either the
before or after run. The claim that row-lock serialization is "bounded in scope"
is **asserted, not demonstrated** — and the event-loop coupling found later
suggests it may not be.

**OPS-2204 — the interaction optimum.** Lowering `MAX_INFLIGHT` sheds more,
which raises event-loop lag, which lengthens OPS-2203's lock hold; raising it
past ~36 brings OPS-2204's OOM back. There is a real optimum between those and
**it was not found.**

**OPS-2204 — a per-route concurrency cap.** The global in-flight limit cannot
distinguish a ~3.6 MiB export from a ~0 MiB admit. A per-route cap is the change
that would decouple them and it was **not attempted.**

**Grafana panels.** The capture sheet at
[`evidence/grafana-captures.md`](./evidence/grafana-captures.md) lists what is
shot and what is not. Rows marked ⛔ are inapplicable, not pending — the run
that would have produced the window never happened.

**Two OPS-2202 findings that framed OPS-2204 and proved right:** peak RSS
reached **148.7 MiB of 160 MiB (93%) under search load alone**, and clustering
hit **96–99.6%** of the cap. **Memory is the shared ceiling in this container** —
which is why the export, needing 34.47 MiB per concurrent caller before the fix,
killed the process at three of them.

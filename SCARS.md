# 🩹 Scar Log — Regional Health on-call lab

Read this at 2am. Every number here was measured; raw output is in
[`evidence/`](./evidence/). Full working in [`LAB_JOURNAL.md`](./LAB_JOURNAL.md).

**Scope:** OPS-2201 and OPS-2202 were investigated and fixed. **OPS-2203 was
touched only as a regression test of my own shipped work** (scar OPS-2202-R) —
its root cause was not investigated. OPS-2204 was not worked at all. See
[Not investigated](#not-investigated).

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
- **C — Cause:** **The pool of 2 was not undersized — it was rationing access to a serialized resource.** Admits to one hospital row serialize on an InnoDB X row lock held for the whole transaction, including the 500 ms `notifyBedRegistry` call inside it ([`api/server.js:133`](./api/server.js#L133)). Single-row throughput is `1/W_lock` ≈ **2 admits/s regardless of pool size** — extra connections buy *waiters*, not throughput. Raising the pool to 25 put **25 transactions on one row, 24 of them WAITING behind 1 holder** (`performance_schema.data_locks`), so the last waiter's wait `(N−1) × 0.5 s` = 12 s exceeded the 5 s `innodb-lock-wait-timeout`. `Innodb_row_lock_time_avg` measured **5,276 ms** — pinned at the timeout. **Queueing became failing.**
- **A — Action:** **None. This is documented, not fixed.** A fix could not be verified within the deadline, and shipping an unverified fix is what this lab spent two incidents learning not to do.
- **R — Result:** Regression confirmed with a control arm (pool=2 → **0** timeouts; pool=25 → **88**), which is what makes it causal rather than correlational. Crossover arithmetic: `(N−1) × 0.5 s < 5 s` ⇒ **N ≤ 10 safe, crossover at N ≈ 11.** **Values between 3 and 10 were not measured** — the bound is arithmetic plus two endpoints.
- **Scar / lesson:** **A change measured as a no-op on one endpoint was a regression on another.** The pool raise was verified against `/recent` and `/search` (+1.0%, −0.1%) and shipped on that evidence. It was never measured against the endpoint whose service time is **958× larger** (508.86 ms vs 0.531 ms) — and that is the only endpoint where pool size could possibly matter, since `N = λ·W` scales with W. **The endpoint I used to justify the change (admit) is the one I did not test it on.** Verify a shared-resource change against the endpoint with the *longest* hold time, not the most traffic.
  **Alert that would have caught it:** `db_errors_total{code="ER_LOCK_WAIT_TIMEOUT"} > 0` — it fires cleanly here and would have fired on the first deploy. Notably this is the *only* incident in this lab where error-rate alerting works, because it is the only one where the system fails rather than degrades.
- **Evidence:** [`evidence/OPS-2203-partial/`](./evidence/OPS-2203-partial/) — `k6-pool25.txt`, `k6-pool2-control.txt`, `innodb-status.txt` (TRANSACTIONS verbatim), `error-code-breakdown.txt`.

> **Decision required — revert or not.** Recommended: **revert the default to
> `MYSQL_POOL_SIZE=8`** (one line, [`api/database.js:38`](./api/database.js#L38)),
> because (a) pool=2 is *measured* to produce zero timeouts, (b) OPS-2202's A/B
> measured the raise as worth **+1.0%, i.e. nothing**, so reverting costs no
> measured throughput, and (c) 8 stays under the N≈11 crossover while keeping
> headroom above the original 2. **Not done here** because it is a behaviour
> change that could not be re-verified against all four endpoints in the time
> left. **The real fix is not the pool size** — it is moving the 500 ms
> `notifyBedRegistry` call out of the transaction, shrinking the critical section
> from ~508 ms to one `UPDATE`. That is an OPS-2203 fix and was not attempted.

---

## Not investigated

**OPS-2204 (nightly export) was not worked at all.** No reproduction was run, no
fix attempted.

**OPS-2203 was only partially touched** — `reproduce-OPS-2203.js` was run twice,
but solely as a **regression test of my own shipped pool change** (scar
OPS-2202-R above). The incident's actual root cause, its capacity math, its
failure signature at the original pool size (P1), and any fix were **NOT
investigated.** Predictions for both were pre-registered
in [`LAB_JOURNAL.md`](./LAB_JOURNAL.md) **before** the deadline and are left
standing as **untested** — they are hypotheses, not findings.

One measured data point exists for OPS-2204, from baseline service-time
capture: a **1-VU export returned 36,141,185 B (34.47 MiB) per call and did not
OOM** — `RestartCount 0`, `exitCode 0`, `OOMKilled=false`. That is consistent
with the untested prediction of OOM at 2–3 concurrent exports, but does not
test it.

Two findings from OPS-2202 point at OPS-2204 and are worth reading first:
peak RSS reached **148.7 MiB of 160 MiB (93%) under search load alone**, and
clustering hit **96–99.6%** of the cap. **Memory is the shared ceiling in this
container**, and the export needs 34.5 MiB per concurrent caller.

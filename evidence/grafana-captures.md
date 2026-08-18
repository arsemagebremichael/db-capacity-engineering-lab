# Grafana capture sheet

I can't take screenshots. This is the shoot list — every panel the journal
references, with the exact PromQL and time window, so it can be captured in one
pass. Each row's **Save as** path matches a placeholder already sitting in
[`../LAB_JOURNAL.md`](../LAB_JOURNAL.md).

**Grafana:** http://localhost:3001 → dashboard **"Capacity Lab — Regional Health"**
(`/d/capacity-lab`, folder *Capacity Lab*). Anonymous auth is on; no login needed.
The four provisioned panels are:

| # | Panel title | PromQL |
|---|---|---|
| 1 | Throughput (req/s) by route | `sum(rate(http_requests_total[1m])) by (route)` |
| 2 | p95 latency by route | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))` |
| 3 | API memory vs container limit (OOM watch) | `process_resident_memory_bytes` and `nodejs_heap_size_used_bytes` |
| 4 | DB errors by code | `sum(rate(db_errors_total[1m])) by (code)` |

**How to set the window:** use the absolute time picker with the UTC run window
recorded in each run's evidence file (`run window (unix): START -> END`), padded
by 1 minute either side so the `[1m]` rate windows are fully populated. Relative
windows like "last 15 minutes" drift and won't match the journal's numbers.

> Timestamps are filled in as each incident is worked. Rows marked ⛔ are **not
> pending** — they are inapplicable, because the run that would have produced the
> window never happened; the reason is stated in the row. Rows marked ⏳ are not yet
> captured because that incident hasn't run.

---

## Baseline (captured 2026-08-12)

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| `baseline/grafana-throughput.png` | 1 — Throughput by route | `1786505333` → `1786505487` (all 3 runs, pad ±1m) | Three flat ~49.6 req/s plateaus on `/api/patients/recent`, separated by two idle gaps. Flat is the point — no ramp, no decay. |
| `baseline/grafana-p95.png` | 2 — p95 latency by route | same | `/api/patients/recent` steady in the 15–25 ms band. This is the line every incident panel gets compared against. |
| `baseline/grafana-memory.png` | 3 — Memory vs limit | same, padded to ±5m | Heap flat ~22 MiB, RSS flat ~98 MiB, far below the 160 MB cap. Establishes the flat-memory control for OPS-2204. |

Individual run windows (unix epoch), if you'd rather shoot them separately:

- run 1: `1786505333` → `1786505363`
- run 2: `1786505395` → `1786505425`
- run 3: `1786505456` → `1786505487`

---

## OPS-2201 — patient search slow at shift change ✅ READY TO SHOOT

Windows were recovered from Prometheus itself (contiguous spans where
`sum(rate(http_requests_total{route="/api/patients/search"}[30s])) > 5`), not
from my notes, so they are exact.

**Correction to something I said earlier:** later load does **not** overwrite
these windows. Prometheus appends; it does not overwrite, and default retention
is 15 days. So the OPS-2201 window stays queryable while the stack keeps
running, and shooting these later is fine.

**The real risk is different, and it is worth acting on.** The `prometheus`
service in [`../docker-compose.yml`](../docker-compose.yml) mounts **only its
config file — there is no volume for `/prometheus` data**. All history therefore
lives in the container's writable layer. It survives `restart` and `stop/start`,
but **`docker compose down`, `rm`, or any rebuild of that container destroys
every measurement in this file's windows permanently.** Since the evidence
`.txt` files are committed and the Grafana panels are not, the panels are the
fragile half. Shoot them before any teardown, and avoid `docker compose down`
for the remainder of the lab.

### Durability rule for the rest of the lab

The asymmetry is the whole point: **`evidence/` is the only durable copy of
anything Prometheus-derived.** The k6 summaries, `EXPLAIN` plans, `docker stats`
captures and INNODB dumps are plain files, committed to git, and survive
anything. The metrics history behind every Grafana panel is not — it is
unreplicated container-local state.

That asymmetry gets sharper from here, because **the remaining incidents
deliberately provoke container instability**:

- **OPS-2203** drives 500 concurrent writers at one row; the API may be
  restarted between fix attempts.
- **OPS-2204** is *designed* to OOM-kill the API repeatedly (P2 predicts exit
  137 and a climbing `RestartCount`). Diagnosing it may well involve rebuilding
  the API image to change how the export streams.

Restarting `capacity-api` is safe for Prometheus history — different container.
But a rebuild that tempts a `docker compose down`, or a `down -v` to reset the
data set, takes the metrics with it.

> **Practical rule: shoot each incident's panels before starting the next one.**
> Not because the data expires — it doesn't — but because the next two incidents
> are spent provoking exactly the kind of instability that ends in someone
> typing `docker compose down`.

If a full teardown does become unavoidable, say so first and the affected
windows get marked **NOT MEASURED** in the journal rather than quietly
disappearing.

**The one shot that tells the whole story:** panel 1 (Throughput) over the FULL
span `1786506075` → `1786507615` (03:41:15 → 04:06:55 UTC, ~26 min). On a
**logarithmic y-axis** it shows every phase in one image: three flat plateaus at
~34 req/s, unchanged across the index fix, a step to ~52 after the projection,
then a cliff up to ~4,250 after pagination. The visual point is that the first
step does nothing and the last one changes everything.

| Save as | Panel | Window (unix) | Peak rps | What it should show |
|---|---|---|---|---|
| ✅ `OPS-2201/grafana-throughput-ALL.png` | 1 — Throughput | `1786506075` → `1786507615` | — | **CAPTURED — but on a LINEAR y-axis, so only the final 4,250 req/s spike is legible; the 34 / 34 / 52 phases are flat against zero. RE-SHOOT WITH LOG SCALE** to show the whole arc, which is where the "index changed nothing" finding lives. |
| `OPS-2201/grafana-throughput-before.png` | 1 — Throughput | `1786506185` → `1786506235` | 34.3 | Flat ~34 req/s plateau under unbounded offered load = a ceiling, not a slope. This is the observed run with timestamped MySQL sampling. |
| `OPS-2201/grafana-p95-before.png` | 2 — p95 latency | `1786506185` → `1786506235` | — | `/api/patients/search` p95 at ~7 s against a baseline band of 19 ms. |
| `OPS-2201/grafana-memory-before.png` | 3 — Memory vs limit | `1786506285` → `1786506325` | 34.6 | RSS peaking 148.7 MiB against the 160 MiB cap — 93%. Draw the 160 MiB line. |
| `OPS-2201/grafana-throughput-fixA.png` | 1 — Throughput | `1786506815` → `1786507025` | 35.6 | **The negative result.** Post-index, still ~35 req/s. Same height as the before shot — that is the finding. |
| `OPS-2201/grafana-throughput-fixB.png` | 1 — Throughput | `1786507085` → `1786507205` | 51.9 | Step up to ~52 req/s after dropping `notes`. |
| `OPS-2201/grafana-throughput-fixC.png` | 1 — Throughput | `1786507295` → `1786507415` | 4262.7 | Jump to ~4,250 req/s after pagination. |
| `OPS-2201/grafana-p95-fixC.png` | 2 — p95 latency | `1786507295` → `1786507415` | — | p95 down to ~53 ms, under the 200 ms SLO line. |
| `OPS-2201/grafana-memory-fixC.png` | 3 — Memory vs limit | `1786507295` → `1786507415` | — | RSS down to ~46 MiB (29% of cap). Same y-axis as the before shot. |
| `OPS-2201/grafana-blast-radius.png` | 2 — p95 **by route** | `1786507575` → `1786507615` | 4384.6 | Both routes on one panel: `/search` AND the untouched `/recent` both healthy, versus `/recent` at 5.8 s in the before shot. |

Phase → window reference (all unix, from Prometheus):

```
1786506075 -> 1786506115   before, run 1            peak 33.2 rps
1786506185 -> 1786506235   before, run 2 (observed) peak 34.3 rps
1786506285 -> 1786506325   before, saturation probe peak 34.6 rps
1786506815 -> 1786506895   fix A (index) runs 1-2   peak 35.0 rps
1786506935 -> 1786507025   fix A (index) runs 3-4   peak 35.6 rps
1786507085 -> 1786507205   fix B (projection)       peak 51.9 rps
1786507295 -> 1786507415   fix C (pagination)       peak 4262.7 rps
1786507475 -> 1786507525   fix C constraint probe   peak 4374.3 rps
1786507575 -> 1786507615   blast-radius re-test     peak 4384.6 rps
```

**Also worth one shot, not on the provisioned dashboard** — add a panel or use
Prometheus directly, since this is the resource that actually ran out:

```promql
nodejs_eventloop_lag_p99_seconds
rate(process_cpu_seconds_total{app="capacity-api"}[10s])
```
over `1786506185` → `1786507415`. Save as `OPS-2201/prom-eventloop-cpu.png`.
Expect CPU pinned at ~1.48 cores through the 34 req/s and 52 req/s phases —
**the same CPU ceiling at both throughputs**, which is the visual proof that the
constraint never moved.

## OPS-2202 — app freezes during surge, DB idle ✅ READY TO SHOOT

Windows recovered from Prometheus, same method as OPS-2201.

| Save as | Panel | Window (unix) | What it should show |
|---|---|---|---|
| `OPS-2202/grafana-throughput-before.png` | 1 — Throughput | `1786508482` → `1786508512` | Flat ~3,400 req/s plateau that does **not** rise as VUs ramp 0→2000. A flat line under rising offered load is the signature of a fixed-size resource. |
| `OPS-2202/grafana-p95-before.png` | 2 — p95 latency | `1786508482` → `1786508512` | p95 ~696 ms against the 19 ms baseline band, while throughput stays flat — queueing, not slow work. |
| `OPS-2202/grafana-errors-before.png` | 4 — DB errors by code | `1786508482` → `1786508512` | **An EMPTY panel, and that is the finding.** `db_errors_total` never created a series. The DB is not involved in the failure at all. |
| `OPS-2202/grafana-poolAB.png` | 1 — Throughput | `1786511092` → `1786511272` | The pool A/B: four alternating runs, pool 2 / 25 / 2 / 25, **all the same height**. P3a made visible. |
| **`OPS-2202/grafana-admission-control.png`** | 1 — Throughput, **stacked by `status_code`** | `1786510612` → `1786510792` | **The money shot.** Total ~10,000 req/s of which ~93% is a 503 band and a thin ~600 req/s band of 200s. Overload made *visible* — the whole argument for admission control in one image. |
| `OPS-2202/grafana-inflight-sweep.png` | Add panel: `http_requests_in_flight` | `1786510312` → `1786511062` | The gauge pinned flat at each successive `MAX_INFLIGHT` (8/16/32/64/256/1024/4096) — the limiter provably doing its job. |
| **`OPS-2202/grafana-clustering-memory.png`** | 3 — Memory vs limit | `1786511512` → `1786511677` | **The forward reference to OPS-2204.** RSS climbing 77 → 120 → 154 → 159 MiB against the 160 MiB cap as WORKERS goes 1→4, with throughput *falling* after 2. Memory, not CPU, is the container's real limit. |

Phase → window reference (all unix, from Prometheus):

```
1786508482 -> 1786508512   OPS-2202 reproduce (before)        peak  3,412 rps
1786508812 -> 1786508887   fix 1, pool raise verification     peak  3,667 rps
1786508962 -> 1786509142   INVALID pool A/B (env never applied — see journal)
1786509202 -> 1786509292   admission control N=64             peak 10,305 rps
1786510312 -> 1786510447   INVALID MAX_INFLIGHT sweep (env never applied)
1786510612 -> 1786510792   MAX_INFLIGHT sweep, REDONE valid   peak 10,828 rps
1786510942 -> 1786511062   MAX_INFLIGHT sweep N=8/16/32       peak 11,412 rps
1786511092 -> 1786511272   pool A/B, REDONE valid             peak  3,484 rps
1786511512 -> 1786511677   clustering WORKERS=1/2/3/4         peak  2,715 rps
```

Two of those windows are **invalidated experiments** and are labelled so
deliberately. If they are ever shot, caption them as the broken runs — they look
like clean results, which is exactly the problem (see LAB_JOURNAL.md, OPS-2202,
"A methodology error that invalidated two experiments").

**Also worth one Prometheus shot** — the falsified detector, which is a result in
its own right:

```promql
nodejs_eventloop_lag_p99_seconds
```
over `1786506185` → `1786508512` (spanning OPS-2201 **and** OPS-2202). Expect it
elevated during 2201 (~45 ms) and **flat at ~12–14 ms during 2202's 36× brownout**
— one metric, two identical root causes, one detection and one miss. Save as
`OPS-2202/prom-eventloop-lag-falsified.png`.

## OPS-2203 — bed admissions fail under load

> ### ⚠️ You MUST pin the y-axis by hand for the after-shots
>
> Every panel in this dashboard is `min=auto, max=auto` (verified via the
> dashboard API). For OPS-2203 that silently destroys the comparison, because
> **after the fix panel 4 has no series at all** — `db_errors_total` was never
> created. Grafana renders "No data" and auto-scales the before-shot to its own
> peak, so the two images share no axis and prove nothing.
>
> Set these explicitly in Panel options → Axis → Soft/Standard min–max, the same
> values on BOTH shots of a pair:
>
> | Panel | min | max | why |
> |---|---:|---:|---|
> | 4 — DB errors by code | `0` | **`1.5`** | before-run peak is **1.400 errors/s**; the after-shot must show that same axis with nothing on it |
> | 1 — Throughput by route | `0` | **`20`** | before peak ≈ 2.3 admits/s, after peak ≈ 17–19 admits/s |
>
> **The empty panel is the result.** An auto-scaled empty panel is not evidence
> of anything; an empty panel on an axis that reaches 1.4 errors/s is.
>
> Prometheus `scrape_interval` is **5 s**, so a 30 s run gives ~6 points — enough
> for `rate(...[1m])` but visibly coarse. That is expected, not a capture fault.



| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⏳ `OPS-2203/grafana-errors-before.png` | 4 — DB errors by code | **2026-08-18 06:20:40Z → 06:21:19Z** (the before-run the journal quotes; the Aug 12 pool-25 arm at 05:33:00Z → 05:33:56Z also works) | The error-code breakdown by series name. Which code(s) appear is the whole question — 1205 lock-wait-timeout vs something else entirely. |
| ⏳ `OPS-2203/grafana-throughput-before.png` | 1 — Throughput by route | 2026-08-12 05:32:30Z → 05:39:10Z (both arms) | Admits/sec plateau. Predicted near 1/W ≈ 1.97/s from the 1-VU measurement; the panel either confirms that ceiling or refutes it. |
| ⏳ `OPS-2203/grafana-throughput-after.png` | 1 — Throughput by route | 2026-08-18 06:30:26Z → 06:30:57Z (post-fix) | Same axes as the before shot. Admits plateau lifts 2.30 → 19.80/s; the `db_errors_total` series **disappears entirely**. |
| ⏳ `OPS-2203/grafana-errors-after.png` | 4 — DB errors by code | 2026-08-18 06:30:26Z → 06:30:57Z (post-fix) | The empty panel is the result: no `ER_LOCK_WAIT_TIMEOUT` series exists after the fix. Same y-axis as the before shot or it proves nothing. |

## OPS-2204 — nightly export crashes the service

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⛔ `OPS-2204/grafana-memory-before.png` | 3 — Memory vs limit | **n/a — no such window exists** | **Not a pending capture — a correctly absent one.** `reproduce-OPS-2204.js` was never run, so no export storm was ever generated and there is no RSS sawtooth in the TSDB to photograph. Would show the sawtooth climbing into the 160 MB cap *if* the incident were ever run. |
| ⛔ `OPS-2204/grafana-throughput-before.png` | 1 — Throughput by route | **n/a — no such window exists** | **Not a pending capture — a correctly absent one.** Same reason: no export storm was ever generated. Would show other routes collapsing during the storm *if* the incident were ever run. |
| ⛔ `OPS-2204/grafana-memory-after.png` | 3 — Memory vs limit | **n/a — no fix, no before shot** | **Not a pending capture — a correctly absent one.** There is no OPS-2204 fix and no before shot to compare against. |

---

## Extra query, worth running by hand in Prometheus (http://localhost:9090)

Not on the provisioned dashboard, but directly relevant to OPS-2204's
"GC pause trend" journal row:

```promql
# GC pause time rate — rises sharply as live heap approaches the cap
sum(rate(nodejs_gc_duration_seconds_sum[1m])) by (kind)

# process restarts: a falling process_start_time_seconds step = a restart
process_start_time_seconds
```

Save any capture of these as `OPS-2204/prom-gc-pauses.png`.

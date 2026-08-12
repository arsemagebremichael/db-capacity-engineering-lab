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

> Timestamps are filled in as each incident is worked. Rows marked ⏳ are not yet
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

## OPS-2201 — patient search slow at shift change

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⏳ `OPS-2201/grafana-p95-before.png` | 2 — p95 latency by route | TBD (fill from `evidence/OPS-2201/k6-before.txt`) | `/api/patients/search` p95 far above the baseline band, while `/api/patients/recent` — if probed concurrently — stays low or does not. That contrast is the evidence. |
| ⏳ `OPS-2201/grafana-throughput-before.png` | 1 — Throughput by route | TBD | Search throughput plateauing well below offered load = a ceiling, not a slope. |
| ⏳ `OPS-2201/grafana-p95-after.png` | 2 — p95 latency by route | TBD (post-fix) | Same axes as the before shot, so the two are visually comparable. |

## OPS-2202 — app freezes during surge, DB idle

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⏳ `OPS-2202/grafana-throughput-before.png` | 1 — Throughput by route | TBD | Throughput plateau that does **not** rise as VUs ramp 0→2000. A flat line under rising offered load is the signature of a fixed-size resource. |
| ⏳ `OPS-2202/grafana-p95-before.png` | 2 — p95 latency by route | TBD | p95 climbing roughly linearly with offered load while throughput stays flat — queueing, not slow work. |
| ⏳ `OPS-2202/grafana-errors-before.png` | 4 — DB errors by code | TBD | Whether errors are DB-sourced at all. An *empty* panel here is itself a finding: it would mean requests died in the app tier, not the database. |
| ⏳ `OPS-2202/grafana-throughput-after.png` | 1 — Throughput by route | TBD (post-fix) | Same axes as before. |

## OPS-2203 — bed admissions fail under load

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⏳ `OPS-2203/grafana-errors-before.png` | 4 — DB errors by code | TBD | The error-code breakdown by series name. Which code(s) appear is the whole question — 1205 lock-wait-timeout vs something else entirely. |
| ⏳ `OPS-2203/grafana-throughput-before.png` | 1 — Throughput by route | TBD | Admits/sec plateau. Predicted near 1/W ≈ 1.97/s from the 1-VU measurement; the panel either confirms that ceiling or refutes it. |
| ⏳ `OPS-2203/grafana-throughput-after.png` | 1 — Throughput by route | TBD (post-fix) | Same axes as before. |

## OPS-2204 — nightly export crashes the service

| Save as | Panel | Window (UTC) | What it should show |
|---|---|---|---|
| ⏳ `OPS-2204/grafana-memory-before.png` | 3 — Memory vs limit | TBD | The money shot: RSS sawtooth climbing into the 160 MB cap, each tooth ending in a vertical drop = process death + restart. Add the cap as a reference line if it isn't drawn. |
| ⏳ `OPS-2204/grafana-throughput-before.png` | 1 — Throughput by route | TBD | Throughput of *other* routes collapsing during the export storm — proves blast radius beyond the export caller. |
| ⏳ `OPS-2204/grafana-memory-after.png` | 3 — Memory vs limit | TBD (post-fix) | Bounded, flat memory under identical load. Same y-axis as the before shot or the comparison is meaningless. |

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

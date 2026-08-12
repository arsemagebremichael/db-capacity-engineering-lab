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

**The one shot that tells the whole story:** panel 1 (Throughput) over the FULL
span `1786506075` → `1786507615` (03:41:15 → 04:06:55 UTC, ~26 min). On a
**logarithmic y-axis** it shows every phase in one image: three flat plateaus at
~34 req/s, unchanged across the index fix, a step to ~52 after the projection,
then a cliff up to ~4,250 after pagination. The visual point is that the first
step does nothing and the last one changes everything.

| Save as | Panel | Window (unix) | Peak rps | What it should show |
|---|---|---|---|---|
| `OPS-2201/grafana-throughput-ALL.png` | 1 — Throughput | `1786506075` → `1786507615` | — | **Primary shot.** Log y-axis. Whole arc: 34 → 34 → 52 → 4,250. |
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

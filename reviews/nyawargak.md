# 📊 Marking & Scoring — Gatchang Nyawargak

**Repo:** https://github.com/Gatchang-nyawargak/db-capacity-engineering-lab
**Branch scored:** `main` @ `679a6bf` (4 commits, latest 2026-08-11)
**Graded:** 2026-08-11 · against `ASSIGNMENT.md` rubric + `instructor-guide.md` (incl. deviations)

---

## TL;DR verdict

**Overall: 28 / 100 — Incomplete submission.**

This is a tale of two grades. The work that *is* present — the **baseline** and
**OPS-2201** — is **A-grade, arguably the sharpest possible answer**: the student
not only diagnosed the full table scan but **caught Deviation A** (the index does
*not* fix the SLO; the real driver is the `SELECT *` payload) — the deepest
insight the instructor guide flags as full-marks material.

But **3 of the 4 incidents (OPS-2202, 2203, 2204) and the entire post-incident
synthesis are untouched** — left as the blank template. `SCARS.md` has only 1 of
4 entries filled. Roughly **75% of the required investigation was not attempted.**

> If OPS-2201 were graded in isolation it would score **~94/100**. The overall
> mark is dragged down almost entirely by *missing work*, not by wrong work.

---

## Deliverable completeness (Definition of Done)

| Requirement | Status |
|---|---|
| Baseline captured first & used as comparison | ✅ Done well |
| All four incidents reproduced (k6 pasted) | ⚠️ Only OPS-2201 (1/4) |
| Root cause + mechanism + capacity math per incident | ⚠️ Only OPS-2201 (1/4) |
| A fix applied **and re-run**, before/after, per incident | ⚠️ Only OPS-2201 (1/4) |
| `LAB_JOURNAL.md` fully filled incl. synthesis | ❌ ~30% filled; 2201 Fix box blank; synthesis blank |
| `SCARS.md` — all four entries | ⚠️ 1/4 (2202/2203/2204 still template stubs) |
| Everything committed & pushed to own repo | ✅ Yes (public, clean commits) |
| Repo link shared on Slack | ✅ (this task) |

---

## Score breakdown

Allocation: Baseline 8 · four incidents 20 each · Synthesis 8 · Scar-log quality 4.
Per-incident internal weighting follows the rubric (Hypothesis 10% · Observation
30% · Root cause+math 35% · Fix&verify 25%).

| Section | Earned | Max | Notes |
|---|---|---|---|
| Baseline | **8** | 8 | Real numbers, SLOs stated, evidence file + Grafana png |
| OPS-2201 | **19** | 20 | Excellent; incl. Deviation-A insight. Ding: Journal *Fix & verify* box left blank (content only in SCARS) |
| OPS-2202 | **0** | 20 | Not attempted — template stub |
| OPS-2203 | **0** | 20 | Not attempted — template stub |
| OPS-2204 | **0** | 20 | Not attempted — template stub |
| Synthesis | **0** | 8 | Blast-radius ranking / one-fix / alerts all blank |
| Scar logs (quality) | **1** | 4 | 1 strong entry; 3 empty |
| **Total** | **28** | **100** | |

---

## What went well (credit where due)

### Baseline — full marks
- RPS **49.12/s**, p50 **5.48ms**, p95 **44.52ms**, errors **0%**, steady heap ~19MB.
- SLOs explicitly set and carried forward: *p95 < 200ms · errors < 1% · RPS ≥ ~45*.
- Evidence committed (`evidence/00-baseline.txt`, `evidence/baseline-grafana.png`).
- This is exactly the "control group" discipline the rubric demands.

### OPS-2201 — exemplary (the highlight of the submission)
- **Hypothesis (10/10):** written pre-run, reasoned, and states *how* it will be
  proven/disproven (EXPLAIN rows-examined + before/after p95 vs baseline).
- **Observation (~28/30):** `EXPLAIN ANALYZE` before → `Table scan on patients`,
  cost 10276, **100,000 rows** examined → 10,000 matched. k6 before: p95 **55.15s**,
  RPS **4.22/s**, 920 MB received. Numbers, not adjectives. ✔
- **Root cause + capacity math (~33/35):** names *full table scan*, *missing
  secondary index*, walks the *clustered index*; states **O(N) → O(log N + k)**
  with a B-tree and reasons about 10% selectivity for `Smith`. ✔
- **Fix & verify — the standout:** added `INDEX idx_patients_last_name (last_name)`
  (persisted in `data-seed/seed.sh`), re-ran EXPLAIN → `Index lookup … rows=10000`,
  and re-ran k6 → p95 **57.25s**, RPS **4.91/s**. **The student correctly noticed
  the index did NOT recover the SLO** and pinned the real bottleneck on the
  ~10k-row `SELECT *` payload under concurrency. This is precisely
  **Deviation A** in the instructor guide — the guide awards *full marks* for
  "adds the index AND notices it doesn't help, then identifies the payload /
  `SELECT *` as the real driver." ✔✔
- Scar-log entry (OPS-2201) is tight, number-first, links evidence, and states a
  pre-emptive alert ("rows examined ≫ rows returned"). Model example.

**Only nit on 2201:** the Journal's *Fix & verify* subsection is still the blank
`______` template — all the fix content lives in `SCARS.md` instead. It should
be mirrored into the journal since that's Deliverable 1. Hence 19/20, not 20.

---

## What's missing (the reason for the low overall mark)

- **OPS-2202 (pool exhaustion):** not attempted. Journal + SCARS are blank
  stubs. `connectionLimit: 2` untouched in `api/database.js`. No k6, no
  Little's-Law derivation, no evidence.
- **OPS-2203 (row-lock contention):** not attempted. No `data_locks` capture,
  no 1/W math, no fix. (Would also have surfaced Deviation C — the 1205 error
  that never fires.)
- **OPS-2204 (export OOM / O(N) memory):** not attempted. No `docker stats`,
  no heap evidence, no streaming/pagination fix.
- **Post-incident synthesis:** blank. No blast-radius ranking, no
  "one-fix-before-launch" call, no per-incident alerting proposal.
- The single deepest lab insight — that `connectionLimit: 2` is the *shared*
  lever behind 2201/2202/2203 — was not reachable because the other incidents
  weren't worked.

---

## Feedback to the student

You clearly *know how to do this work* — the OPS-2201 investigation is the best
possible version of that answer, including a subtlety (index ≠ SLO fix; payload
is the real cost) that many strong engineers miss. The problem is purely
**coverage**: three of four incidents and the synthesis are unstarted.

To bring this to a passing/strong grade, in priority order:
1. **OPS-2202** — reproduce, show DB idle while p95 explodes, derive pool size
   from Little's Law (L = λ·W), fix the pool, and note the app-CPU ceiling.
2. **OPS-2204** — capture heap vs 160/256MB limit, name O(N) resident memory,
   fix by streaming/pagination, re-run.
3. **OPS-2203** — capture a lock waiter/blocker from `performance_schema.data_locks`,
   state 1/W = 2 admits/s, move the 500ms notify out of the transaction.
   (Heads-up: the promised 1205 error may not fire as configured — reporting
   "total stall, no error" is a *correct* observation, not a failure.)
4. **Fill the Journal OPS-2201 Fix box** (copy from your SCARS entry) and
   **write the synthesis** (blast-radius ranking + one-fix + alerts).
5. Bonus: connect the dots — `connectionLimit: 2` ties 2201/2202/2203 together.

**Grade: 28/100 (Incomplete).** Re-submit with the remaining incidents and this
moves quickly into strong territory — the quality bar you set on 2201 is already
well above passing.

# 📊 Review — Gatchang Nyawargak

| Field | Value |
|---|---|
| **Submission** | `github.com/Gatchang-nyawargak/db-capacity-engineering-lab` @ `679a6bf` |
| **Reviewed** | `2026-08-11` · rob |
| **Assessed against** | `ASSIGNMENT.md` rubric + `instructor-guide.md` (incl. deviations) |
| **Score** | **28 / 100** |
| **Grade** | `Incomplete` |
| **Verdict** | A-grade on OPS-2201; 3 of 4 incidents + synthesis untouched. |

---

## 🎯 Scorecard

| Section | Weight | Score | | 1-line note |
|---|--:|--:|---|---|
| Baseline | 8 | 8 | ▰▰▰▰▰▰▰▰▰▰ | Real numbers, SLOs set, evidence + Grafana png |
| OPS-2201 | 20 | 19 | ▰▰▰▰▰▰▰▰▰▱ | Excellent — incl. Deviation-A insight; Journal Fix box left blank |
| OPS-2202 | 20 | 0 | ▱▱▱▱▱▱▱▱▱▱ | Not attempted — template stub |
| OPS-2203 | 20 | 0 | ▱▱▱▱▱▱▱▱▱▱ | Not attempted — template stub |
| OPS-2204 | 20 | 0 | ▱▱▱▱▱▱▱▱▱▱ | Not attempted — template stub |
| Synthesis | 8 | 0 | ▱▱▱▱▱▱▱▱▱▱ | Blank — ranking / one-fix / alerts all empty |
| Scar logs | 4 | 1 | ▰▰▱▱▱▱▱▱▱▱ | 1 strong entry; 3 empty stubs |
| **Total** | **100** | **28** | | OPS-2201 alone ≈ 94/100 |

---

## 1. 📋 What was asked  *(did the deliverables land?)*

| # | Deliverable | Required? | Status | Evidence / where |
|---|---|:--:|:--:|---|
| 1 | Baseline captured first, used as comparison | ✅ | ✅ Done | `evidence/00-baseline.txt`, `baseline-grafana.png` |
| 2 | All 4 incidents reproduced (k6 pasted) | ✅ | ⚠️ Partial | Only OPS-2201 (`evidence/OPS-2201-before.txt`) |
| 3 | Root cause + mechanism + capacity math ×4 | ✅ | ⚠️ Partial | Only OPS-2201 |
| 4 | Fix applied **and re-run**, before/after ×4 | ✅ | ⚠️ Partial | Only OPS-2201 (in SCARS, not Journal) |
| 5 | `LAB_JOURNAL.md` fully filled incl. synthesis | ✅ | ❌ Missing | ~30% filled; 2201 Fix box blank; synthesis blank |
| 6 | `SCARS.md` — all four entries | ✅ | ⚠️ Partial | 1/4 (2202/2203/2204 stubs) |
| 7 | Committed & pushed to own public repo | ✅ | ✅ Done | 4 clean commits |

> **Legend:** ✅ complete · ⚠️ partial · ❌ missing · ➖ n/a

---

## 2. ✅ What you did well  *(evidence, not praise — each line has a number)*

- **Baseline is textbook** — RPS `49.12`, p50 `5.48ms`, p95 `44.52ms`, errors `0%`, heap `~19MB`; SLOs set (`p95<200ms · err<1% · RPS≥45`).
- **OPS-2201 evidence captured** — `EXPLAIN ANALYZE` → `Table scan`, `100,000` rows examined → `10,000` matched; k6 before p95 `55.15s`, RPS `4.22`, `920MB` received.
- **Capacity math named correctly** — full table scan, missing secondary index, `O(N) → O(log N + k)` with a B-tree, ~10% selectivity for `Smith`.
- **Caught Deviation A (the full-marks insight)** — noticed the index did *not* recover the SLO (after p95 `57.25s`) and pinned the `SELECT *` ~10k-row payload as the real driver.
- **Fix is real + persisted** — `INDEX idx_patients_last_name (last_name)` committed to `data-seed/seed.sh` (`dfa0532`); EXPLAIN after → `Index lookup … rows=10000`.

---

## 3. ⚠️ What you missed  *(ranked by points lost — every row ends in an action)*

| Rank | Gap | Impact | Pts lost | 👉 Do this |
|:--:|---|---|:--:|---|
| 1 | OPS-2202 (pool exhaustion) not attempted | −20 vs 0 earned | −20 | Reproduce; show DB idle w/ p95 spike; derive pool via Little's Law `L=λ·W`; fix pool; note app-CPU ceiling |
| 2 | OPS-2203 (row-lock) not attempted | −20 | −20 | Capture a waiter/blocker from `data_locks`; state `1/W = 2 admits/s`; move 500ms notify outside txn |
| 3 | OPS-2204 (export OOM) not attempted | −20 | −20 | Capture heap vs 160/256MB; name O(N) memory; fix by streaming/pagination; re-run |
| 4 | Synthesis blank | −8 | −8 | Rank blast radius w/ your numbers; pick one launch fix; list per-incident alert |
| 5 | SCARS 3/4 stubs | −3 | −3 | Fill 2202/2203/2204 scar entries (S·C·A·R + lesson) |
| 6 | OPS-2201 Journal *Fix & verify* box blank | Content only in SCARS | −1 | Copy the fix/verify numbers into the Journal section (that's Deliverable 1) |

---

## 4. 🧾 Bottom line  *(facts + next moves)*

**Facts**
- `1 of 4` incidents worked; `~28/100` overall despite OPS-2201 quality of `~94/100`.
- Definition-of-Done checklist satisfied: `~1.5 of 8` items.
- `connectionLimit: 2` untouched in `api/database.js` — the shared lever behind 2201/2202/2203 was never reached.

**Do next — in order**
1. OPS-2202 — widest blast radius, fastest win.
2. OPS-2204 — second-highest impact (whole-instance outage).
3. OPS-2203 — capture the lock chain; report "total stall, no error" if that's what you see (it's correct).
4. Fill the OPS-2201 Journal Fix box + write the synthesis.

**Grade: 28/100 — Incomplete.** The bar you set on OPS-2201 is already well above passing — finish the other three incidents and this jumps into strong territory fast.

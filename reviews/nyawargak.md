# 🛠️ Engineering Review: Gatchang Nyawargak

| Snapshot | |
|---|---|
| **Target** | `github.com/Gatchang-nyawargak/db-capacity-engineering-lab` @ `679a6bf` |
| **Reviewer** | rob · `2026-08-11` |
| **Status** | `🚧 Needs Work — 1 of 4 incidents submitted (28/100)` |
| **Superpower Shown** | Baseline discipline + the "the index didn't actually fix it" catch on OPS-2201 — senior-level instinct. |
| **TL;DR** | Your OPS-2201 work is genuinely sharp; now run that exact same loop on the other three incidents and the synthesis. |

---

## 🧭 1. System Health *(How this submission measures up)*

| Vector | Health | Score | | Mentor's Note |
|---|--:|--:|---|---|
| Investigation & Evidence | 30 | 10 | ▰▰▰▱▱▱▱▱▱▱ | Baseline + 2201 evidence are strong; 2202/2203/2204 have zero captures. |
| Root-Cause & Capacity Math | 30 | 8 | ▰▰▰▱▱▱▱▱▱▱ | 2201 names full-scan / B-tree / O(N)→O(log N+k). Nothing for the rest. |
| Fix & Verification | 20 | 5 | ▰▰▱▱▱▱▱▱▱▱ | 2201 index shipped + re-run — but the fix write-up lives only in SCARS. |
| Coverage & Synthesis | 20 | 5 | ▰▰▱▱▱▱▱▱▱▱ | 1/4 incidents, synthesis blank, SCARS 1/4 filled. |
| **Total** | **100** | **28** | | OPS-2201 in isolation ≈ 94/100. |

---

## 🎯 2. The Baseline *(Deliverables check)*

| Status | Feature / Requirement | Evidence / Location |
|:--:|---|---|
| ✅ | Baseline captured first, SLOs set | `evidence/00-baseline.txt`, `baseline-grafana.png` |
| ✅ | OPS-2201 — hypothesis, observation, root cause | `LAB_JOURNAL.md` §OPS-2201; `OPS-2201-explain-before.txt` |
| 🚧 | OPS-2201 — fix & verify | In `SCARS.md`, **not** in the Journal's Fix box |
| ❌ | OPS-2202 (pool exhaustion) | — |
| ❌ | OPS-2203 (row-lock contention) | — |
| ❌ | OPS-2204 (export OOM) | — |
| ❌ | Post-incident synthesis | — |
| 🚧 | `SCARS.md` — 4 entries | 1/4 done; 2202/2203/2204 are template stubs |

> **Legend:** ✅ Nailed it · 🚧 Needs a tweak · ❌ Missing / Blocked

---

## 🌟 3. What You Nailed *(Keep doing this)*

*These are patterns worth keeping in your engineering toolbelt.*

- **Control-group discipline** — captured baseline *first*: RPS `49.12`, p50 `5.48ms`, p95 `44.52ms`, err `0%`, and set SLOs (`p95<200ms · err<1% · RPS≥45`) to judge every incident against.
- **Reading the query plan** — `EXPLAIN ANALYZE` → `Table scan on patients`, `100,000` rows examined → `10,000` matched; named the mechanism, didn't just say "slow."
- **Verifying the fix instead of assuming it** — added the index, re-ran under load, saw p95 *stay* at `57.25s`, and correctly concluded the `SELECT *` ~10k-row payload — not the scan — is the real bottleneck. That's the exact instinct this lab is testing for.

---

## 💡 4. The Refactor Zone *(Where we level up)*

*Here is how we evolve this submission to a complete, production-grade write-up.*

| 🔴 Priority | The Challenge | System Impact | 🛠️ The Next-Level Pattern |
|:--:|---|---|---|
| **High** | 3 of 4 incidents unstarted (2202, 2203, 2204) | 75% of the on-call skill set is unassessed; fails Definition of Done | **Fix:** Run each through the full loop: hypothesis → k6 reproduce → observe → root cause + math → fix → re-run.<br>**Principle:** Every incident earns its marks from *evidence*, not the guess — a captured before/after beats a correct hunch. |
| **High** | Post-incident synthesis blank | No blast-radius ranking / launch call / alerting story | **Fix:** Rank the four by measured error-rate & availability impact; name the one fix to ship pre-launch; give one alert per incident.<br>**Principle:** Root-causing is half the job — prioritising across incidents is what on-call actually pays for. |
| **Med** | OPS-2201 fix/verify only in `SCARS.md` | Journal (Deliverable 1) reads as unfinished | **Fix:** Mirror the index+re-run numbers into the Journal's *Fix & verify* box.<br>**Principle:** Put the evidence where the grader (and next engineer) will look — don't make them hunt across files. |
| **Low** | SCARS 3/4 are empty stubs | Scar log can't do its 2am job | **Fix:** One S·C·A·R + lesson per remaining incident.<br>**Principle:** A scar log is the fastest artifact the *next* on-call reads — keep it tight and number-first. |

---

## 🚀 5. Getting to 'Approved' *(Your Action Plan)*

**Mentor's Note:**
> You cracked the hardest, most subtle part of this whole lab on OPS-2201 — noticing the "obvious" index fix *didn't* move the SLO and chasing the real driver. That's the senior move. The only thing standing between this and a strong grade is coverage: three incidents and the synthesis are still on the runway.

**Let's knock these out in order:**
1. **P0:** OPS-2202 — reproduce, show the DB idle while p95 spikes, size the pool with Little's Law (`L = λ·W`), raise `connectionLimit`, note the app-CPU ceiling.
2. **P1:** OPS-2204 — capture heap vs the 160/256MB limit, name O(N) memory, fix with streaming/pagination, re-run for a flat heap.
3. **P2:** OPS-2203 — capture a waiter/blocker from `performance_schema.data_locks`, state `1/W = 2 admits/s`, move the 500ms notify outside the transaction. (If you see a total stall with *no* DB error, that's a correct observation — report it.)
4. **P3:** Fill the OPS-2201 Journal Fix box + write the synthesis + the 3 remaining SCARS.

**Need a pair programming session on P0?** Ping me on Slack if you're stuck for more than 15 mins — OPS-2202 is the highest-leverage one to unblock first.

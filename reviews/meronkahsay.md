# 🛠️ Engineering Review: Meron Kahsay

| Snapshot | |
|---|---|
| **Target** | `github.com/meronkahsay/db-capacity-engineering-lab` @ `f2e8ae3` |
| **Reviewer** | rob · `2026-08-11` |
| **Status** | `✅ Ready to Merge — 97/100, Distinction` |
| **Superpower Shown** | Disproving the ticket's premise with captured evidence — on all four incidents. |
| **TL;DR** | Reference-quality work across the whole lab; one sentence of synthesis away from a perfect score. |

---

## 🧭 1. System Health *(How this submission measures up)*

| Vector | Health | Score | | Mentor's Note |
|---|--:|--:|---|---|
| Investigation & Evidence | 30 | 29 | ▰▰▰▰▰▰▰▰▰▰ | k6 + `EXPLAIN` + `docker stats` + lock views on all 4; −1 for missing 2202/2203 pngs. |
| Root-Cause & Capacity Math | 30 | 30 | ▰▰▰▰▰▰▰▰▰▰ | Little's Law, `1/W`, and O(N) memory all derived from *measured* values. |
| Fix & Verification | 20 | 20 | ▰▰▰▰▰▰▰▰▰▰ | One dedicated fix commit per incident, before/after in every message. |
| Coverage & Synthesis | 20 | 18 | ▰▰▰▰▰▰▰▰▰▱ | 4/4 + full synthesis; −2: the cross-cutting root lever is only implied. |
| **Total** | **100** | **97** | | |

---

## 🎯 2. The Baseline *(Deliverables check)*

| Status | Feature / Requirement | Evidence / Location |
|:--:|---|---|
| ✅ | Baseline first + SLOs justified | `LAB_JOURNAL.md` §Baseline; `evidence/baseline/*.png` |
| ✅ | OPS-2201 — index + `LIMIT 50` fix | commit `d4071f7`, `api/server.js` |
| ✅ | OPS-2202 — pool + payload fix | commit `6a28f6b`, `api/{database,server}.js` |
| ✅ | OPS-2203 — commit-then-notify + guarded update | commit `922cabb`, `api/server.js` |
| ✅ | OPS-2204 — streaming + pagination | commit `bfe2eb8`, `api/server.js` |
| ✅ | Post-incident synthesis | commit `c364021`, `LAB_JOURNAL.md` |
| ✅ | `SCARS.md` — 4 entries | 4/4, number-first |
| 🚧 | Grafana screenshots per incident | Only baseline, 2201, 2204 (no 2202/2203) |

> **Legend:** ✅ Nailed it · 🚧 Needs a tweak · ❌ Missing / Blocked

---

## 🌟 3. What You Nailed *(Keep doing this)*

*Patterns executed at a senior level — bank these.*

- **"The obvious fix isn't the fix" — four times** — 2201: index alone left p95 `13.23s`; `LIMIT 50` → `132.22ms` @ `2407 req/s`. You followed the `~3GB data_received` to the real cost.
- **Little's Law from measured inputs** — 2202: `W=1.73ms` × `λ=1620/s` → `~2.8` conns needed vs configured `2`; then caught the *second* ceiling (synchronous `JSON.stringify` on the event loop — CPU `173%` → `0.83%` after payload trim).
- **Ground-truth over theory** — 2204: hypothesis said kernel OOM-kill; `docker inspect` said `OOMKilled:false`. You corrected to V8's `--max-old-space-size` fatal error (heap `253–259MB`), `13` restarts → `0`.
- **Fixing beyond the brief** — 2204: saw streaming fixes memory but not bytes (`4.4GB` / `14.78%` timeouts), added cursor pagination, and fixed a real `res.setHeader`-after-`res.write` bug with HTTP trailers.
- **Auditable delivery** — one clean commit per incident, each with before/after numbers in the message.

---

## 💡 4. The Refactor Zone *(Where we level up)*

*Small polish to take this from a 97 to a flawless exemplar.*

| 🔴 Priority | The Challenge | System Impact | 🛠️ The Next-Level Pattern |
|:--:|---|---|---|
| **Med** | The shared root lever is implied, not stated | Misses the lab's single deepest takeaway | **Fix:** Add one line to the synthesis — `connectionLimit:2` drives 2201/2202/2203, and raising it in 2202 is *why* 2203's `1205` errors surfaced.<br>**Principle:** When one fix keeps recurring across "independent" tickets, name the coupling — that's the systems-thinking payoff. |
| **Low** | No Grafana pngs for 2202 & 2203 | Brief asks for a capture per incident | **Fix:** Drop the two dashboards into `evidence/ops-2202/` and `ops-2203/`.<br>**Principle:** A screenshot is the fastest proof a reviewer can verify at a glance. |
| **Low** | k6 summaries quoted inline only | Slightly less auditable than an artifact | **Fix:** Commit raw runs as `evidence/*.txt` beside the inline quotes.<br>**Principle:** Inline for reading, committed file for re-checking — keep both. |

---

## 🚀 5. Getting to 'Approved' *(Your Action Plan)*

**Mentor's Note:**
> This is the strongest submission in the cohort — you didn't just pass each ticket, you disproved its premise with numbers on all four, and the OPS-2204 investigation (self-correcting the OOM theory, then catching the streaming-vs-bandwidth distinction) is senior-SRE work. Nothing here blocks a merge; the items below are pure polish.

**Optional polish, in order:**
1. **P0:** Add the one-line `connectionLimit` coupling to the synthesis — the perfect capstone.
2. **P1:** Backfill the 2202/2203 Grafana screenshots.
3. **P2:** Commit raw k6 runs as `evidence/*.txt`.

**Need a pair programming session?** Not for this one — instead, let's talk about turning this into an anonymised model answer for the next cohort.

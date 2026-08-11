# 📊 Marking & Scoring — Meron Kahsay

**Repo:** https://github.com/meronkahsay/db-capacity-engineering-lab
**Branch scored:** `main` @ `f2e8ae3` (8 commits, dated 2026-08-09)
**Graded:** 2026-08-11 · against `ASSIGNMENT.md` rubric + `instructor-guide.md` (incl. deviations)

---

## TL;DR verdict

**Overall: 97 / 100 — Distinction. Reference-quality submission.**

Complete on every deliverable: baseline + all four incidents + full synthesis,
a four-entry `SCARS.md`, and a **dedicated fix commit with a real code diff per
incident**. But the score isn't about completeness — it's that this student
independently discovered **every single deviation** the instructor guide flags
as the hardest, full-marks insight, and proved each one with captured numbers:

- **Deviation A (2201):** noticed the index *doesn't* fix the SLO and pinned the
  `SELECT *` payload as the real driver — then fixed it with `LIMIT 50`.
- **Deviation B (2202):** noticed the pool bump alone doesn't fix throughput and
  identified the Node **event-loop / JSON-serialization CPU** as the second ceiling.
- **2203:** captured a real 171-row lock-wait chain + `ER_LOCK_WAIT_TIMEOUT` at
  46% error rate, derived 1/W = 2 admits/s, and honestly characterised the
  residual ~1s p95 as an *architectural* single-row ceiling (proven by a
  pool-size A/B test), not an unfixed bug.
- **Deviation D (2204):** corrected its *own* hypothesis with evidence
  (`OOMKilled: false`; it was V8's `--max-old-space-size` fatal error, not a
  kernel kill), found streaming alone insufficient (4.4 GB transferred), added
  pagination, **and found+fixed a genuine HTTP-trailers bug** along the way.

This is the strongest possible version of this lab. The 3-point deduction is
minor and noted below.

---

## Deliverable completeness (Definition of Done)

| Requirement | Status |
|---|---|
| Baseline captured first & used as comparison | ✅ Full k6 block + SLOs + Grafana png |
| All four incidents reproduced (k6 pasted) | ✅ 4/4, raw summaries inline |
| Root cause + mechanism + capacity math per incident | ✅ 4/4, all with numbers |
| A fix applied **and re-run**, before/after, per incident | ✅ 4/4, dedicated commits |
| `LAB_JOURNAL.md` fully filled incl. synthesis | ✅ Complete, incl. synthesis |
| `SCARS.md` — all four entries | ✅ 4/4, tight and number-first |
| Everything committed & pushed to own repo | ✅ Clean, per-incident commits |
| Repo link shared | ✅ (this task) |

---

## Score breakdown

Allocation: Baseline 8 · four incidents 20 each · Synthesis 8 · Scar-log quality 4.

| Section | Earned | Max | Notes |
|---|---|---|---|
| Baseline | **8** | 8 | Full k6 summary, p50–p99, SLOs stated + justified, variance note, Grafana png |
| OPS-2201 | **20** | 20 | Full-marks incl. Deviation A; index+LIMIT fix, ~84–100× before/after |
| OPS-2202 | **20** | 20 | Little's Law derived from measured W & λ; Deviation B (event-loop ceiling) caught |
| OPS-2203 | **20** | 20 | Real lock-wait chain + 1205, 1/W math, honest architectural-ceiling analysis |
| OPS-2204 | **20** | 20 | Self-corrected hypothesis w/ evidence, streaming→pagination, trailers bug fixed |
| Synthesis | **8** | 8 | Blast-radius ranking justified w/ own numbers; one-fix call; per-incident alerts |
| Scar logs (quality) | **4** | 4 | All four excellent; each names a pre-emptive alert |
| Raw deduction | **−3** | — | See "Minor gaps" |
| **Total** | **97** | **100** | |

---

## Highlights (why this is reference-quality)

- **Evidence culture is exemplary.** Numbers everywhere, adjectives nowhere. Every
  claim is backed by a pasted k6 block, `EXPLAIN ANALYZE`, `docker stats`,
  `SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%'`, or a GC log line.
- **The "obvious fix doesn't work" skill — four times.** The assignment says the
  strongest submissions "notice when the obvious fix doesn't work and follow the
  evidence to the real bottleneck." This student did that on *every* incident and
  named the pattern explicitly across them.
- **OPS-2203** goes beyond the guide: reproduced the `ER_LOCK_WAIT_TIMEOUT` (which
  the guide notes is hard to produce as-shipped — it surfaced here because the
  pool had been raised to 20 in the 2202 fix, exactly the condition the guide
  predicts), captured the single-file waiter chain, and *disproved* pool size as
  the residual cost via a 20→50 A/B test (p95 1.11s→1.06s) plus a
  `Innodb_row_lock_time_avg` 4992ms→117ms measurement.
- **OPS-2204** is the standout: hypothesis correction backed by `docker inspect`
  `OOMKilled: false` + the actual V8 fatal-error log; recognised streaming fixes
  *memory* but not *total bytes* (4.4 GB / 14.78% timeouts); added cursor
  pagination on the indexed PK; and caught that `res.setHeader` after
  `res.write()` is silently dropped, switching to `res.addTrailers` — a real
  production-grade bug outside the lab's scope.
- **Synthesis** ranks blast radius with its own measured error rates and correctly
  argues 2204 (100% outage, crash-loop, no natural containment) as the one
  ship-before-launch fix, contrasting it against 2203's per-row self-limiting scope.
- **Fixes are real and isolated.** One clean commit per incident, each with a
  before/after summary in the message — trivially auditable diffs.

---

## Minor gaps (the −3)

- **Grafana screenshots for 2202 and 2203 are absent** — `evidence/` holds only
  baseline, 2201, and 2204. The inline raw evidence (k6, docker stats, lock
  views) more than compensates, but the assignment explicitly asks for Grafana
  screenshots per incident. (−1)
- **k6 summaries are quoted inline rather than committed as raw `evidence/*.txt`
  files.** Fine for readability; slightly less auditable than a committed run
  artifact. (−1)
- **The deepest cross-cutting insight is *implied* but not stated.** The student
  repeatedly observed the same "fix one resource, expose the next" pattern and
  saw pool interactions in 2203 — but never explicitly connected that
  `connectionLimit` is the single shared lever behind 2201/2202/2203, i.e. that
  raising it in 2202 is precisely *why* 2203's 1205 errors appeared. That is the
  guide's "deepest insight available in this lab," and it was one sentence away. (−1)

---

## Feedback to the student

This is the best submission I could reasonably expect from this lab — genuinely
production-engineer-grade. You didn't just pass each ticket; you disproved the
ticket's premise with evidence on all four, which is the entire point of the
exercise. The OPS-2204 investigation (self-correcting the OOM hypothesis, then
catching the streaming-vs-bandwidth distinction, then the trailers bug) is
something I'd expect from a senior SRE, not a lab.

One thing to push you further next time: when you notice the *same* fix
(bounding a result set; raising the pool) recurring across incidents, step back
and ask whether the tickets share a single root lever. Here they did —
`connectionLimit: 2` is the hidden common cause behind three of the four, and
your own 2202→2203 sequence is living proof (raising the pool is what unmasked
2203's lock-wait errors). Naming that coupling in the synthesis would have been
the perfect capstone.

**Grade: 97/100 — Distinction.** Exemplar submission; suitable to share
(anonymised) as a model answer for future cohorts.

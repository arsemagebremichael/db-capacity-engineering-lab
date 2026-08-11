<!--
  ENGINEERING GROWTH REVIEW — copy to reviews/<mentee>-<project>.md
  
  The Mentor's Golden Rules (Warm, Constructive, Ready):
    1. Critique the Code, Champion the Coder: Assume positive intent.
    2. Teach the Pattern: Don't just give the answer; explain the architectural 'why'.
    3. Impact over Opinion: Frame feedback around system health (perf, scale, UX), not preference.
    4. Unblock Immediately: Ensure they leave the review knowing exactly what to type next.
    5. Score bars use 10 blocks: ▰ = filled, ▱ = empty (e.g., 7/10 -> ▰▰▰▰▰▰▰▱▱▱).
-->

# 🛠️ Engineering Review: <Mentee Name>

| Snapshot | |
|---|---|
| **Target** | `<repo / PR link>` @ `<commit>` |
| **Reviewer** | `<Your Name>` · `<YYYY-MM-DD>` |
| **Status** | `<Ready to Merge / Needs Refactor / Blocked>` |
| **Superpower Shown** | `<E.g., Great defensive programming on the API boundary>` |
| **TL;DR** | `<One warm, concise sentence summarizing the review, e.g., "Incredible progress on the UI, let's just tighten up the state management before we ship.">` |

---

## 🧭 1. System Health *(How this PR measures up)*

| Vector | Health | Score | | Mentor's Note |
|---|--:|--:|---|---|
| <Architecture / Logic> | 30 | 25 | ▰▰▰▰▰▰▰▰▱▱ | <E.g., Clean separation of concerns; great custom hooks.> |
| <Code Quality / DRY> | 30 | 20 | ▰▰▰▰▰▰▱▱▱▱ | <E.g., Some repeated logic in the table rows we can extract.> |
| <Testing / Edge Cases> | 20 | 10 | ▰▰▰▱▱▱▱▱▱▱ | <E.g., Happy paths are covered, but missing null states.> |
| <Perf / Scalability> | 20 | 18 | ▰▰▰▰▰▰▰▰▰▱ | <E.g., O(1) lookups on the data transformation—excellent.> |
| **Total** | **100** | **NN** | | |

---

## 🎯 2. The Baseline *(Deliverables check)*

| Status | Feature / Requirement | Evidence / Location |
|:--:|---|---|
| ✅ | <Deliverable 1> | `auth.service.ts` (L45-80) |
| 🚧 | <Deliverable 2> | Working, but throws console errors on unmount |
| ❌ | <Deliverable 3> | — |

> **Legend:** ✅ Nailed it · 🚧 Needs a tweak · ❌ Missing / Blocked

---

## 🌟 3. What You Nailed *(Keep doing this)*

*These are the patterns you executed perfectly. Add these to your engineering toolbelt.*

- **<Concept, e.g., Memoization>** — `<Metric/Proof: You avoided unnecessary re-renders in the heavy list component by wrapping it in useMemo (List.tsx L12). Huge win for low-end devices.>`
- **<Concept>** — `<Metric/Proof>`
- **<Concept>** — `<Metric/Proof>`

---

## 💡 4. The Refactor Zone *(Where we level up)*

*Here is how we evolve this code for production scale.*

| 🔴 Priority | The Challenge | System Impact | 🛠️ The Next-Level Pattern |
|:--:|---|---|---|
| **High** | <E.g., N+1 Database Query> | <E.g., Works locally, but will crash the DB when users > 1000.> | **Fix:** Batch the query using DataLoader.<br>**Principle:** Network/DB calls inside loops scale linearly. We always batch. |
| **Med** | <E.g., Magic Strings> | <E.g., Harder to maintain; typos won't be caught by TS.> | **Fix:** Extract 'pending', 'active' to an Enum.<br>**Principle:** Let the compiler do the work for you. |
| **Low** | <Challenge> | <Consequence> | **Fix:** <Action><br>**Principle:** <Why this matters> |

---

## 🚀 5. Getting to 'Approved' *(Your Action Plan)*

**Mentor's Note:**
> `<1-2 warm sentences of reality. E.g., "You cracked the hardest part of this feature—the logic is brilliant. Our only gap right now is making sure it doesn't break when the API fails.">`

**Let's knock these out in order:**
1. **P0:** <Highest-leverage unblocking action, e.g., Wrap the fetch call in a try/catch block and handle the 500 error state.>
2. **P1:** <Next action>
3. **P2:** <Next action>

**Need a pair programming session on P0?** `<Yes/No - Ping me on Slack if you're stuck for more than 15 mins.>`

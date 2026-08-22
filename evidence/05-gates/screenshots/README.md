# C5 screenshots — the gates firing

Run numbers are GitHub Actions runs in this repo. Each gate's story reads top to
bottom.

## gitleaks — PR #2

| File | Run | Result | What it proves |
|---|---|---|---|
| `gitleaks-1-VACUOUS-green-run4-secret-committed.png` | #4 | ✅ **green** | The gate was **broken**. "No leaks detected" while `.env.demo` held a committed AWS key. `.gitleaks.toml` had an `[allowlist]` but no `[extend]`, so gitleaks loaded **zero rules**. Every prior green check was meaningless. |
| `gitleaks-2-red-pr2-checks.png` | #7 | ❌ red | PR view: `gitleaks` failing, `trivy-config` and `zizmor` passing — so it is gitleaks specifically catching this, not a general build failure. `build-and-scan-image` and `deploy-and-verify` **skipped**: the gate blocked the pipeline rather than reporting after the fact. |
| `gitleaks-3-red-run7-detected-secrets.png` | #7 | ❌ red | The finding itself: rule `aws-access-token`, commit `89a03d4`, `.env.demo` line 3. |
| `gitleaks-4-red-run8-delete-did-not-fix.png` | #8 | ❌ red | **`git rm` did not fix it.** The fix commit removed the file and the gate still failed, because CI scans full history (`fetch-depth: 0`) and the secret was still in the parent commit. |
| `gitleaks-5-green-run9-after-history-rewrite.png` | #9 | ✅ green | Only rewriting the branch actually cleared it. |

The lesson in rows 1 and 4 is worth more than the demo itself: a green check
means *the rules that were loaded found nothing* — it does not tell you any
rules were loaded. And deleting a committed secret does not un-commit it; the
real remediation is history rewrite **plus rotation**, because the value was
exposed the moment it was pushed. (These were fabricated values.)

## trivy config — PR #4

| File | Run | Result | What it proves |
|---|---|---|---|
| `trivy-1-red-run11-AVD-AWS-0107.png` | #11 | ❌ red | A "temporary" debug security group with SSH open to `0.0.0.0/0` — caught as `AVD-AWS-0107`. gitleaks and zizmor green beside it. |
| `trivy-2-green-run12-sg-removed.png` | #12 | ✅ green | Rule removed, full pipeline runs through to `deploy-and-verify`. |
| `trivy-3-red-run14-regression-caught.png` | #14 | ❌ red | **The gate caught an accident, not a demo.** A follow-up fix used `HEAD~1`, a relative ref that by then pointed at the commit *introducing* the rule — so the "fix" restored the vulnerability. trivy caught the same rule a second time. |

Contrast with gitleaks: a misconfiguration only exists at the tip, so one
revert cleared it. A secret persists in history, so it needed a rewrite. Same
"fix the finding" instinct, very different remediation cost.

## zizmor — PR #5

| File | Run | Result | What it proves |
|---|---|---|---|
| `zizmor-1-red-run15-unpinned-uses.png` | #15 | ❌ red | The reusable-workflow ref moved from a 40-char SHA to `@main`. `unpinned-uses` caught it; gitleaks and trivy-config green beside it. A moving ref means someone else's merge silently changes the gates this repo runs under — the tj-actions/changed-files failure mode. |
| `zizmor-2-green-run17-repinned.png` | #17 | ✅ green | Re-pinned to a 40-char SHA. All five jobs run through to `deploy-and-verify`. |

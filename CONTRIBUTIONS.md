# CONTRIBUTIONS

Arsema Gebremichael — Assignment 2, individual rehost.

A summary, not the evidence; the real record is git history in both repos.

## Group platform — [akezasaloi/regional-health-platform](https://github.com/akezasaloi/regional-health-platform)

| Role | PR |
|---|---|
| **Authored** | [PR #3](https://github.com/akezasaloi/regional-health-platform/pull/3) — PR-C, the golden CI pipeline: gitleaks → trivy-config → zizmor → build+scan image → apply → verify |
| **Authored** | [PR #16](https://github.com/akezasaloi/regional-health-platform/pull/16) — `app_dir` / `terraform_dir` inputs so individual repos can call the pipeline, plus the E2 OIDC design block |
| **Reviewed** | [PR #1](https://github.com/akezasaloi/regional-health-platform/pull/1) `modules/data`, [PR #2](https://github.com/akezasaloi/regional-health-platform/pull/2) `modules/service`, [PR #5](https://github.com/akezasaloi/regional-health-platform/pull/5) bootstrap / Makefile / seed |

## Individual rehost — this repo

This repo **consumes** the group platform rather than duplicating it:
`terraform/main.tf` composes `modules/data` and `modules/service` by pinned
commit SHA, and `.github/workflows/ci.yml` calls the group's reusable workflow
at the same SHA.

| PR | What |
|---|---|
| [#1](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/1) | Rehost onto the group platform — terraform root, `secrets.js`, health probes, hardened image, alert rules (C1–C9) |
| [#3](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/3) | `.gitleaks.toml` was loading **zero rules** — the gate had been passing on everything |
| [#2](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/2) | C5 gitleaks gate demo — red, then green |
| [#4](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/4) | C5 trivy gate demo — red, then green |
| [#5](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/5) | C5 zizmor gate demo — red, then green |

## Status

| | State |
|---|---|
| C1 — Terraform from zero | ✅ `evidence/01-iac/` (apply.log, empty plan-after-apply) |
| C2 — schema + seed | ✅ `evidence/02-data/` (10,000 patients in Aiven) |
| C3 — managed secrets | ✅ `evidence/03-secrets/` |
| C4 — liveness vs readiness | ✅ `evidence/04-health/readyz-degraded.txt` |
| C5 — gates that block | ✅ `evidence/05-gates/` — three red PRs, scanner output, screenshots |
| C6 — alerts + dashboards | ◐ rules written and wired; panels outstanding |
| C7 — incident replay | ☐ outstanding |
| C8 — `make verify` | ✅ all five checks pass |
| C9 — `FIDELITY.md` | ✅ six caveats with detection method |
| E2 — OIDC design | ✅ `docs/oidc-trust-policy.json` + README |

`evidence/01-iac/destroy.log` lands with the C6/C7 session, when the stack is
torn down.

# C5 — gates that actually block

Three tools, three jobs, each with `exit-code: '1'` or an equivalent non-zero
exit. A scanner that runs but never blocks is theatre, so each gate below was
proven by deliberately introducing the flaw it exists to catch, watching CI go
red, and then fixing it.

Pipeline: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — the
reusable workflow, called by [`pr.yml`](../../.github/workflows/pr.yml) on every
pull request.

## The three red PRs

| Gate | Insecure change | Rule that fired | Red PR | Red run | Fix |
|---|---|---|---|---|---|
| gitleaks | fabricated AWS key committed in `.env.demo` | `aws-access-token` | [#2](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/2) | [run 7](https://github.com/arsemagebremichael/db-capacity-engineering-lab/actions/runs/32538776713) | [`5295bc9`](https://github.com/arsemagebremichael/db-capacity-engineering-lab/commit/5295bc9) — history rewrite |
| trivy config | debug security group, SSH ingress `0.0.0.0/0` | `AVD-AWS-0107` (HIGH) | [#4](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/4) | [run 11](https://github.com/arsemagebremichael/db-capacity-engineering-lab/actions/runs/32539547612) | [`f6d0c5c`](https://github.com/arsemagebremichael/db-capacity-engineering-lab/commit/f6d0c5c) |
| zizmor | reusable-workflow ref moved from a 40-char SHA to `@main` | `unpinned-uses` (HIGH) | [#5](https://github.com/arsemagebremichael/db-capacity-engineering-lab/pull/5) | [run 15](https://github.com/arsemagebremichael/db-capacity-engineering-lab/actions/runs/32540256737) | [`599d3a0`](https://github.com/arsemagebremichael/db-capacity-engineering-lab/commit/599d3a0) |

Scanner output is committed alongside this file — the failing state
(`gitleaks-red.json`, `trivy-config-red.json`, `zizmor-red.txt`) and the clean
state after the fix (`trivy-config.json`, `trivy-image.json`, `zizmor.txt`).
Screenshots of every run, with an index, are in [`screenshots/`](screenshots/).

Two of these fixes needed more than the obvious revert:

- **gitleaks** — `git rm .env.demo` was *not* enough. CI scans full history
  (`fetch-depth: 0`), so the fix commit still failed on the secret in its
  parent. Only rewriting the branch cleared it. For a real credential the
  remediation is rewrite **plus rotation**: the value was exposed the moment it
  was pushed.
- **trivy** — the first fix used `HEAD~1`, a relative ref that by then pointed
  at the commit *introducing* the rule, so it restored the vulnerability. The
  gate caught the same finding a second time
  ([run 14](https://github.com/arsemagebremichael/db-capacity-engineering-lab/actions/runs/32540174449)). A gate catching an accident is
  better evidence than one catching a staged demo.

## What each gate does **not** catch

Knowing the limits of a green check is the point of this section.

**gitleaks** matches patterns that *look like* credentials — high-entropy
strings, known token shapes. It cannot tell that a legitimate-looking value is
live, and it will not flag a password that looks like ordinary prose
(`hunter2`, a passphrase, a base64 blob it has no rule for). It also says
nothing about whether a secret is *appropriate*: a correctly-stored ARN pointing
at an over-permissioned secret passes cleanly. Green means "no known pattern
matched", not "no secrets here".

**trivy** compares declared configuration and installed package versions against
databases of known issues. It cannot reason about runtime: a security group
that trivy passes may still be wide open because LocalStack only honours the
default SG, and a `0.0.0.0/0` egress rule it flags may be entirely correct for a
NAT-less build box. On images it only knows *published* CVEs — a vulnerability
disclosed tomorrow is invisible today, and our scan runs `ignore-unfixed`, so
~48 HIGH/CRITICAL findings with no upstream patch are reported but do not block.
Green means "nothing known and fixable", not "secure".

**zizmor** analyses workflow files statically: unpinned actions, script
injection through `${{ }}` in `run:`, over-broad `permissions`, inherited
secrets. It cannot see *inside* the action it is telling you to pin. A SHA-pinned
action whose code is malicious at that exact commit passes every check — which
is precisely the tj-actions/changed-files failure mode, where tags were
repointed at attacker-controlled code. Pinning defeats tag mutation, not a
compromised maintainer or a zero-day in the tool itself.

## Guard the guards

Pinning is necessary and not sufficient, so the pipeline layers containment and
detection on top of prevention:

- **Integrity** — every `uses:` is a 40-char commit SHA and the container base
  is pinned by digest (`api/Dockerfile`). Bumps arrive as reviewed Dependabot
  PRs ([`dependabot.yml`](../../.github/dependabot.yml)), never `@latest`. The
  `zizmor` step itself is pinned to an exact version for the same reason.
- **Blast radius** — the four scanner jobs run `permissions: contents: read`
  with no `secrets:` block and no `AIVEN_*` or `LOCALSTACK_AUTH_TOKEN` in scope.
  A compromised scanner cannot exfiltrate what its job was never given. Only
  `deploy-and-verify` receives credentials.
- **Detection** — `step-security/harden-runner` runs as the first step of every
  job in egress-audit mode, so a step phoning home to an unexpected host is
  visible after the fact. You cannot prevent an unknown zero-day; you contain it
  and you notice it.
- **Locally** — [`.githooks/pre-commit`](../../.githooks/pre-commit) runs
  gitleaks over staged content before a secret can become a commit. Enable with
  `git config core.hooksPath .githooks`. History rewriting is the expensive
  cure; the commit is the point of no return, not the push.

# Quality Gates & Review Triage Policy

This document governs CI check interpretation, static analysis triage, and review-thread handling in **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Repository-Defined Gates

- Rely strictly on the checks and workflows configured in `.github/workflows/` and `package.json`—do not invent unconfigured gates.
- Wait for triggered CI workflows and automated reviewers via event notifications rather than polling loops.
- **Required Checks on `main`**: The `main` ruleset blocks merging until these checks pass on the pull request head and the branch is up to date with `main`:

  | Check | Workflow | Runs when the pull request | What it verifies |
  |---|---|---|---|
  | `hygiene` | `repo-hygiene.yml` | is opened, reopened, or gets new commits | Whitespace errors, conflict markers, tracked `.env` files |
  | `check (ubuntu-latest)` | `check.yml` | is opened, reopened, or gets new commits | `pnpm check`: types, tests, package boundaries, file headers, third-party notices, running from source |
  | `check (windows-latest)` | `check.yml` | is opened, reopened, or gets new commits | `pnpm test` and `pnpm check:smoke`, the platform-sensitive part; static checks run only on Linux because their result does not depend on the platform |
  | `conventions` | `pull-request.yml` | is opened, reopened, gets new commits, or has its title or description edited | Conventional Commits and English-only title, description, and non-merge commits (`pnpm check:conventions`) |
  | `dependency-review` | `dependencies.yml` | is opened, reopened, or gets new commits | No added dependency with a known vulnerability of moderate or higher severity or with a license outside `allow-licenses` in `.github/dependency-review-config.yml` |

- **CI Runs on Pull Requests Only**: Workflows do not rerun on pushes to `main`, because an up-to-date pull request that passed the required checks squashes to the tree that was checked. Use the manual `workflow_dispatch` trigger of `check` or `repo-hygiene` to check `main` on demand.
- **No Redundant Runs**: Each check runs on the events that can change its result and nowhere else; superseded runs of the same pull request are cancelled.
- **License Allow List**: `.github/dependency-review-config.yml` is the single license allow list; `pnpm check:notices` applies the same list to installed runtime dependencies. Add a license only with the project owner's approval.
- Renaming a required job or matrix entry is a breaking change to the ruleset: update the ruleset's required checks in the same change, or every pull request stays blocked.

---

## 2. Severity Triage Policy

### 2.1 Zero-Tolerance Red Lines
Regardless of which tool or reviewer raises them, fix 100% of confirmed issues in these categories before merging:
1. **Real Bugs**: Logic errors, crashes, invalid state transitions, broken type contracts, resource leaks.
2. **Security Vulnerabilities**: Prompt-injection bypasses, unauthorized command paths, path traversal, unsafe dependencies.
3. **Secret Leakage**: Committed API keys, tokens, passwords, or private credentials.

### 2.2 Non-Blocking Alerts & False-Positive Triage
For non-blocking warnings (style, complexity, duplication, minor lint):
1. **Verify Truthfulness**: Check actual code behavior and context. If confirmed false positive, document the technical rationale in reply.
2. **Fix Locally When Scoped**: If genuine and small, fix cleanly in the current change.
3. **File an Issue When Out-of-Scope**: If genuine but too broad or outside the current PR's scope, create a dedicated tracking Issue and link it in the PR discussion.
4. **No Silent Drops**: Never silently ignore a valid warning without either fixing it or filing a tracking Issue.

---

## 3. Review Feedback Workflow

For every actionable review comment:
1. **Verify** against actual code and contracts.
2. **Fix** minimally and cleanly.
3. **Test** with targeted local verification.
4. **Reply** clearly with the resolution and verification evidence, adhering strictly to [Review Thread Resolution Rules](../git/pr-lifecycle.md#6-strict-review-thread-resolution-rules).

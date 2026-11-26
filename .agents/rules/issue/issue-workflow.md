# Issue Creation, Triage & Lifecycle Workflow

This document defines when to open issues, how to configure GitHub Sidebar metadata, and how to maintain issues through closure in **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Issue Template Adherence

Before opening any issue, read and follow:
- [`.github/ISSUE_TEMPLATE/general-issue.md`](../../../.github/ISSUE_TEMPLATE/general-issue.md)

Ground every issue in verified baseline commit SHAs, reproducible observations, and clear separation between facts and hypotheses.

---

## 2. On-Demand Issue Creation Policy

| Scenario | Policy | Rationale |
|---|---|---|
| **Bug Fix** | **Prefer filing an issue first** | Record baseline commit and reproduction evidence; trivial, single-line obvious fixes may go straight to a PR. |
| **Large or High-Risk Change** | **Must file an issue first** | Cross-package refactors, protocol contract changes, or major new capabilities require upfront alignment. |
| **Routine Refactor / Docs / CI** | **As needed** | May be tracked directly on a task branch unless coordinating multiple contributors. |

---

## 3. GitHub Sidebar Metadata Rules

Separate structured metadata (Sidebar) from technical narrative (Body):

1. **Type (Required — pick one)**:
   - `Bug`: Defect, crash, security flaw, or broken invariant.
   - `Feature`: New capability, preset, or behavior proposal.
   - `Task`: Refactoring, tests, documentation, tooling, or CI work.
   - *Strict Ban*: Never put `bug`, `feature`, or `task` in `Labels`.
2. **Fields (Structured)**:
   - `Priority` (Required): `P0` (critical blocker) through `P4` (backlog/deferrable). Never duplicate `P0`–`P4` as `Labels`.
   - `Effort` (Recommended): Relative complexity estimate.
3. **Labels (Required)**:
   - Confidence label: `confidence/high`, `confidence/medium`, or `confidence/low`.
   - Primary domain label: e.g., `area/kernel`, `area/protocol`, `area/bt`, `area/memory`, `area/llm`, `area/cli`, `area/docs`.
   - Evidence/trait labels when applicable: `evidence/reproduced`, `evidence/test-failure`, `evidence/ci-failure`, `security`, `performance`.
4. **Relationships (Optional)**: Configure `Blocks`, `Blocked by`, `Parent`, `Sub-issue`, or `Relates to` only when real dependencies exist.

---

## 4. Title & Body Conventions

- **Title Format**: `<type>(<scope>): <objective phenomenon or goal>` (matching `Type`: `fix` -> Bug, `feat` -> Feature, `refactor`/`docs`/`chore`/`test` -> Task).
- **Dynamic Sections**: Omit empty optional headings (e.g., omit "Related Issues & References" when none exist). If an issue spans multiple domains, list all affected packages in `Issue Context` and assign the primary label on the Sidebar.

---

## 5. Lifecycle & Closing Standards

- **Before Coding**: Solving agents must re-verify the baseline commit, reproduction steps, and scope, noting verification results in a comment.
- **Progress Updates**: Append new diagnostic facts via comments rather than silently rewriting initial observations.
- **PR Linking**: Link resolving PRs via `Fixes #N` or `Closes #N`.
- **Closing Criteria**: Close an issue ONLY when:
  1. The resolving PR is squash-merged into `main` with all checks passing; or
  2. Investigation proves it is a duplicate (`Duplicate of #N`), false positive, or superseded, with clear technical evidence posted in comments.

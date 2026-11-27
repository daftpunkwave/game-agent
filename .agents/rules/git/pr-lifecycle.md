# Git Branch & Pull Request Lifecycle

This document governs branching, PR creation, template compliance, CI waiting, review resolution, and squash merging for **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Branch Protection & Strict Authorization

- **Protected `main` Branch**: Never commit or push directly to `main`; all changes enter via Pull Request.
- **Strict Authorization**: Commits, pushes, PR creation, and merges require explicit authorization for the current task (never inherited from prior tasks).
- **Task Branches**:
  - Branch from the latest `main`.
  - Preserve existing uncommitted local work; never wipe a working tree with `git reset --hard` or force pushes.
  - Branch naming format: `<type>/<kebab-case-description>` (e.g., `feat/bt-engine`, `fix/gateway-timeout`, `docs/community-standards`).
- **Atomic Commits**: One logical change per commit.

---

## 2. Pull Request Template Compliance

Before creating any PR, read and follow the official template:
- [`.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`](../../../.github/PULL_REQUEST_TEMPLATE/pull_request_template.md)

### 2.1 PR Title
Use Conventional Commits with an imperative verb:
- `<type>(<scope>): <imperative summary>`
- Example: `feat(gateway): enforce 3-stage visibility filtering on server pushes`

### 2.2 Dynamic PR Body Principles
Keep the PR body focused on **Changed What & Why** from a code/diff perspective:
- **Omit Empty Sections**: If no related issues/PRs exist, omit the "Related Issues" heading entirely. For small self-evident changes, omit optional sections ("Implementation Approach", "Notes for Reviewer", "Additional Context").
- **Required Core Content**:
  1. **Summary (What)** and **Motivation (Why)**
  2. **Testing & Verification** (exact commands run and observed results)
  3. **Compatibility & Impact** (explicitly state breaking changes, or state `"No breaking changes"` with technical rationale)

---

## 3. End-to-End PR Ownership

The author/agent creating a PR owns it through merge readiness:
1. All required remote CI checks pass.
2. All human and automated reviewer feedback is verified, addressed, and replied to.
3. All resolvable review threads satisfy the strict resolve criteria below.

---

## 4. Pre-Push Self-Review & CI Wait Discipline

### 4.1 Pre-Push Checklist
Before committing or pushing:
1. Review the full diff (`git diff`) for unintended edits, debug logs, or leftover artifacts.
2. Run change-scoped local checks (see [Verification & Testing](../testing/verification-and-testing.md)).
3. Ensure comments and file headers match updated behavior.

### 4.2 Wait for Active Checks Before Pushing Again
After pushing to a PR, wait for active CI workflows and triggered automated reviewers to finish their current pass before pushing again—never interrupt running reviews with rapid redundant pushes.

---

## 5. Dual-Channel Feedback Extraction & Batch Fix

Once checks and reviews complete:
1. **Extract from Both Channels**:
   - Channel A: All PR general comments and inline review comments (including out-of-diff comments).
   - Channel B: Failure logs from every failed CI check.
2. **Batch Fix & Verify**: Fix all confirmed issues locally, run applicable checks, and push one clean consolidated update.

---

## 6. Strict Review Thread Resolution Rules

All resolvable review threads must be resolved before merging. A review thread may be marked **Resolved** ONLY when one of three conditions holds:
1. **Verified & Fixed**: The issue was real, fixed locally, and verified by checks/tests.
2. **Confirmed False Positive**: Careful inspection of actual code, types, and runtime context proves the report is a false positive, with explanation posted in reply.
3. **Out-of-Scope Tracked Issue**: The feedback is valid but exceeds the current PR boundary, and a dedicated follow-up GitHub Issue has been created and linked in the thread **before** resolving.

Never resolve a thread without fixing, proving false positive, or filing a tracking issue.

---

## 7. Squash Merge & Commit History Preservation

`main` enforces **squash merge** only (no merge commits or rebase merges):
1. **Merge Commit Title**: Use the concise PR title with `(#<PR_NUMBER>)` appended once.
2. **Merge Commit Body**: Preserve the complete titles, bodies, and trailers of every commit in the PR in chronological order—never summarize away or rewrite commit history.
3. **Final Check**: Verify against the final PR head before executing `squash` merge.

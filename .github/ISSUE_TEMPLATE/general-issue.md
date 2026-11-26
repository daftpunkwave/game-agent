---
name: General Issue
about: Structured issue template for bugs, feature proposals, and engineering tasks with clear triage metadata.
---

<!--
Reference template. Ground every issue in verified baseline facts and objective evidence, and configure the GitHub right Sidebar metadata accurately.

[Dynamic & Concise Structure]
Section layout is flexible—adapt it to the task:
- For small, self-contained issues without external links or complex design notes, omit optional sections (Reproduction/Evidence, Impact Scope, Proposed Fix, Related Records).
- Focus on clear facts, current behavior, expected behavior, and accurate Sidebar metadata so external reviewers can evaluate the issue independently.

[GitHub Sidebar Configuration]
1. Type (Required — select one):
   - Bug: System vulnerability, defect, crash, contract violation, or broken invariant.
   - Feature: Proposed new capability, preset, protocol support, or enhancement.
   - Task: Engineering work outside Bug/Feature (refactoring, tests, docs, tooling, CI/CD).
2. Fields (Structured fields):
   - Priority (Required): P0 (critical blocker) to P4 (nice-to-have / backlog).
   - Effort (Optional/Recommended): Relative effort level to complete this issue.
   - Start / Target date (Optional): Planned timeline if applicable.
3. Labels (Required):
   - Confidence level: `confidence/high`, `confidence/medium`, or `confidence/low`.
   - Primary area/domain label: e.g. `area/kernel`, `area/protocol`, `area/bt`, `area/memory`, `area/llm`, `area/cli`, `area/docs`.
   - Evidence / trait labels (as applicable): e.g. `evidence/reproduced`, `evidence/test-failure`, `evidence/ci-failure`, `performance`, `security`.
   - [Strict Rule] Never put `bug`, `feature`, `task`, or `P0`–`P4` in Labels; use native `Type` and `Fields.Priority` instead.
4. Relationships (Optional):
   - Link `Blocks`, `Blocked by`, `Parent`, `Sub-issue`, or `Relates to` when dependencies exist.

[Title Format]
`<type>(<scope>): <objective, verifiable phenomenon or goal>`
Examples:
- `fix(gateway): prevent duplicate command dispatch on reconnect timeout`
- `feat(bt): add schedule window preemption for emergency combat alerts`
- `refactor(kernel): split plugin lifecycle registration from event dispatch`
-->

## Issue Context

1. **Code Baseline**: <!-- Exact Git commit SHA or release version -->
2. **Evidence Type**: <!-- e.g. evidence/reproduced, evidence/test-failure, evidence/ci-failure, evidence/static-analysis -->
3. **Architecture Scope**: <!-- List all affected boundaries/packages, e.g. packages/gateway-boundary, packages/bt-engine -->
4. **Source**: <!-- How this was discovered (local dev, PR review, CI run, cluster telemetry) -->

## Overview

<!-- Concise summary of background, trigger conditions, or business goal. -->

## Actual Behavior / Current State

<!-- Objective description of observed behavior, error logs, or current gap. Clearly separate verified facts from hypotheses. -->

## Expected Behavior / Target State

<!-- Exact expected behavior, invariants, API contracts, or acceptance criteria. -->

## Reproduction / Evidence / Design Notes

<!-- Optional. Minimal reproduction steps, error snippets, or technical design notes. Omit if trivial. -->

## Impact Scope

<!-- Optional. Affected modules, callers, compatibility risks, or temporary workarounds. Omit if not needed. -->

## Proposed Approach & Tests

<!-- Optional. Candidate fix/implementation scope and automated tests to add. Omit if undecided. -->

## Related Issues & References

<!-- Optional. Omit this heading completely if there are no related issues or external links. -->

## Issue Self-Review Checklist

- [ ] **Sidebar Type & Fields**: `Type` (`Bug` / `Feature` / `Task`) and `Fields.Priority` (`P0`–`P4`) are set.
- [ ] **Labels & Relationships**: `confidence/*` and primary domain label are set (no `bug`/`feature`/`task` in Labels).
- [ ] **Baseline & Evidence**: Exact commit SHA and reproducible evidence are provided, distinguishing facts from inferences.
- [ ] **Self-Contained**: Readable and verifiable without access to private chats or internal drafts.
- [ ] **Clear Acceptance Criteria**: Expected invariants or acceptance boundaries are explicitly defined.

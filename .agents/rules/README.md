# Agent Specialized Rules Directory (`.agents/rules/`)

This directory houses specialized execution rules for AI Coding Agents working on **game-agent**, subordinate to the root [AGENTS.md](../../AGENTS.md).

---

## Directory Structure under `.agents/`

- **`rules/` (this directory)**: Mandatory engineering standards, workflows, and quality gates.
- **`skills/`**: Optional task-specific agent skills.
- **`notes/`**: Optional cross-session process notes and architecture decision records.

---

## Index of Rules

| Subdirectory | Rule Document | Responsibility |
|---|---|---|
| `git/` | [pr-lifecycle.md](git/pr-lifecycle.md) | Branch strategy, PR template adherence, end-to-end ownership, CI wait discipline, thread resolve rules, squash merge |
| `git/` | [commit-standards.md](git/commit-standards.md) | Conventional Commits, types/scopes, subject/body standards, self-contained external readability |
| `issue/` | [issue-workflow.md](issue/issue-workflow.md) | Issue creation policy, template adherence, GitHub Sidebar Type/Fields/Labels, lifecycle closure |
| `review/` | [twelve-dimensional-criteria.md](review/twelve-dimensional-criteria.md) | Twelve-dimensional code review checklist and final verification |
| `review/` | [gates-and-triage.md](review/gates-and-triage.md) | CI gate triage, zero-tolerance red lines, non-blocking alert tracking |
| `architecture/` | [engineering-iron-laws.md](architecture/engineering-iron-laws.md) | Pluginized decoupling, SRP (500-line guideline), DIP, single ingress/egress boundary, unidirectional dependencies |
| `conventions/` | [naming-and-headers.md](conventions/naming-and-headers.md) | Intent-oriented naming, forbidden names, English-only convention, source file headers with required fields |
| `testing/` | [verification-and-testing.md](testing/verification-and-testing.md) | Targeted verification tiers, strong assertions, anti-fragile tests |

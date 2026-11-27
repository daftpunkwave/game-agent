# Coding Agent Instructions and Engineering Charter

**game-agent** is a **TypeScript (Node.js 24+)** runtime that runs language-model agents as headless game clients. Games connect through transport adapters (MCP is one of them); every agent has a single ingress and a single egress gateway, an intent ledger, an event inbox, an agent-side behavior tree, and bounded AI decision nodes. The kernel is the in-repo `kernel` package group; the first interaction surface is the `game-agent` CLI. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`.

## Meta-Directive

This file and the specialized specifications under [.agents/rules/](.agents/rules/README.md) form the mandatory execution charter for all AI Coding Agents working in this repository. All requirement analysis, design, coding, refactoring, testing, code review, commits, issues, and pull requests must follow these rules strictly without shortcuts or silent overrides.

---

## Universal Iron Laws

Regardless of task size or module scope, every agent must adhere to the following five iron laws:

### 1. Evidence-Based Judgment
Base every technical decision strictly on actual source code, runtime behavior, dependency graphs, and verified contracts. Never rely on guesswork, surface appearances, or dogmatic rules detached from context. When diagnosing any defect, verify four facts in order: **truthfulness -> real impact -> expected contract -> root-cause fix location**.

### 2. Minimal & Precise Changes
Default to minimal, targeted, complete changes unless a broader refactor is explicitly requested. Preserve existing valid contracts and module boundaries. Do not pad code with redundant defensive branches, empty wrapper interfaces, over-abstraction, blind caching/retries, or brittle mocks. Never introduce unapproved external dependencies.

### 3. Zero Speculation & Zero Artifacts Left Behind
When an architecture boundary, dependency version, or interface contract is unclear, stop guessing—inspect source configs first, official documentation second, and confirm with the maintainer if ambiguity remains. Before delivering, remove all temporary debug statements (`console.log`, `debugger`), commented-out dead code, temporary mocks, and leftover `TODO`/`FIXME` markers.

### 4. Self-Contained & Independent Readability
All external outputs—user replies, commit messages, PR descriptions, issues, review comments, and code comments—must be independently readable and verifiable without private chat context. **Never reference internal project-tracking IDs, internal plan step numbers, or private drafts.** Focus strictly on concrete domain scenarios, code diffs, technical rationale (**Changed What & Why**), and verification evidence. See [Git Commit & Delivery Standards](.agents/rules/git/commit-standards.md#4-self-contained-external-deliverables).

### 5. Protected `main` Branch & Strict Authorization
`main` is protected. Never commit or push directly to `main`. Commits, pushes, PR creation, and merges require explicit authorization for the active task (never inherited from prior sessions). Always branch from the latest `main` using `<type>/<kebab-case-description>`, keeping each commit focused on a single logical change. See [Git Branch & PR Lifecycle](.agents/rules/git/pr-lifecycle.md).

---

## Language Policy (English-Only Repository)

This repository is strictly **English-only** across all source code, comments, file headers, documentation, commit messages, pull requests, issues, and default prompts.
- Do not introduce non-English text into tracked files unless explicitly implementing an `i18n` localization module or locale bundle under a dedicated `i18n`/`locale` boundary.

---

## Repository Layout & Commands

```text
packages/<group>/<name>   @game-agent/<name> workspaces; group rules in packages/README.md
apps/cli                  the game-agent command line
examples/                 runnable behavior trees and agent configs
docs/                     architecture and design documents
scripts/                  repository gates
```

```sh
pnpm install
pnpm typecheck          # tsc over every package, app, script, and test
pnpm test               # vitest
pnpm check:boundaries   # declared deps, no deep imports, acyclic graph, group rules, no Node I/O in cognition packages, SDK confinement
pnpm check:headers      # file headers with Responsibilities, Contracts, and Constraints (other content allowed); no console.log, debugger, TODO, or FIXME in packages and apps
pnpm check:notices      # THIRD_PARTY_NOTICES.md matches runtime dependencies; their licenses are on the allow list
pnpm check:smoke        # every package entry loads and the CLI runs under Node.js from source
pnpm check              # all of the above
pnpm check:conventions  # Conventional Commits and English-only commit messages in origin/main..HEAD (CI also checks PR title and description)
pnpm game-agent help    # run the CLI from source (no build step yet)
```

Source is executed directly by Node.js with `--experimental-transform-types`; there is no build step yet. Use explicit `.ts` extensions in relative imports.

---

## On-Demand Routing

Read only the specifications relevant to the current task to minimize context noise:

| Task Type | Relevant Specifications | Core Focus |
|---|---|---|
| **Bug Fix / Targeted Diagnosis** | Target module source & tests; [Architecture Iron Laws](.agents/rules/architecture/engineering-iron-laws.md) | Four-step root-cause verification, minimal fix, preserve contracts |
| **New Module / Protocol Adapter / Refactor** | [Architecture Iron Laws](.agents/rules/architecture/engineering-iron-laws.md), [Naming & Headers](.agents/rules/conventions/naming-and-headers.md) | Decoupling over cohesion, single ingress/egress boundary, unidirectional deps |
| **Code Review & Quality Triage** | [Twelve-Dimensional Review](.agents/rules/review/twelve-dimensional-criteria.md), [Gates & Triage](.agents/rules/review/gates-and-triage.md) | Red-line zero tolerance, non-blocking alert tracking, thread resolution |
| **Git / Commit / PR / Issue** | [Commit Standards](.agents/rules/git/commit-standards.md), [PR Lifecycle](.agents/rules/git/pr-lifecycle.md), [Issue Workflow](.agents/rules/issue/issue-workflow.md) | Conventional Commits, official templates, squash merge, sidebar metadata |
| **Testing & Verification** | [Verification & Testing](.agents/rules/testing/verification-and-testing.md) | Targeted check tiers, strong assertions, anti-fragile tests |

---

## Specialized Specifications Directory

| Area | Specification | Scope & Triggers |
|---|---|---|
| **PR Lifecycle** | [pr-lifecycle.md](.agents/rules/git/pr-lifecycle.md) | Branching, end-to-end PR ownership, PR template, pre-push self-review, CI wait discipline, dual-channel feedback, thread resolve rules, squash merge |
| **Git Commits** | [commit-standards.md](.agents/rules/git/commit-standards.md) | Conventional Commits types/scopes, English language rule, subject/body quality, diff perspective |
| **Issues** | [issue-workflow.md](.agents/rules/issue/issue-workflow.md) | On-demand issue creation, issue template, GitHub Sidebar Type/Fields/Labels, lifecycle closure |
| **Code Review** | [twelve-dimensional-criteria.md](.agents/rules/review/twelve-dimensional-criteria.md) | 12 engineering review dimensions (Correctness through Testing) plus Final Verification |
| **Quality Gates** | [gates-and-triage.md](.agents/rules/review/gates-and-triage.md) | Repository CI gates, red-line items, non-blocking alert triage (no silent drops) |
| **Architecture** | [engineering-iron-laws.md](.agents/rules/architecture/engineering-iron-laws.md) | Pluginized decoupling, SRP (500-line guideline), DIP, single-port game protocol boundary, unidirectional deps |
| **Naming & Style** | [naming-and-headers.md](.agents/rules/conventions/naming-and-headers.md) | Intent-oriented naming, forbidden names, generic-word control, self-documenting code, file headers with required fields |
| **Testing** | [verification-and-testing.md](.agents/rules/testing/verification-and-testing.md) | Change-scoped verification tiers, strong assertions, anti-fragile mocks, zero test weakening |

---

## Local Overrides & Precedence

Shared rules in `AGENTS.md` and `.agents/rules/` are authoritative. Developers may place gitignored `AGENTS.local.md` files locally for personal workflow preferences; local files may supplement but must never weaken or override repository hard constraints.

Precedence order:
```text
Root AGENTS.md
  └── .agents/rules/*
        └── Subdirectory AGENTS.md
              └── Root AGENTS.local.md
                    └── Subdirectory AGENTS.local.md
                          └── Global AGENTS.md
```

Report any detected rule conflicts to the maintainer rather than resolving them silently.

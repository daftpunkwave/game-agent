# Git Commit & External Delivery Standards

This document governs commit messages, PR descriptions, and all public-facing deliverables for **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Conventional Commits Format

Every commit must follow Conventional Commits:

```text
<type>(<scope>): <subject>

[optional body]

[optional footer / trailers]
```

`scope` is optional; `type` must be selected from:

| Type | Purpose |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix or invariant restoration |
| `docs` | Documentation and repository rules |
| `refactor` | Structural change with no behavior change |
| `perf` | Performance improvement |
| `test` | Test cases, fixtures, and test helpers |
| `style` | Formatting changes that do not affect semantics |
| `build` | Build system, packaging, TypeScript configs, and dependencies |
| `ci` | CI/CD automation (`ci(check)`, `ci(release)`, etc.) |
| `chore` | Maintenance outside the categories above |
| `revert` | Revert an existing commit (`git revert`) with rationale |

### Scope Rules
- Use `build(deps)` for dependency updates (no `deps` type).
- Use domain scopes for security fixes such as `fix(gateway)` or `fix(auth)` (no `security` or `hotfix` type).

---

## 2. Language & Formatting

- **English Only**: Commit titles, bodies, PR titles/bodies, issues, and review replies must be written in clear English.
- **No Artificial 72-Char Hard Wrap**: Do not break sentences awkwardly just to satisfy a 72-character line cap.

---

## 3. Subject & Body Requirements

- **Subject**: Start with an imperative verb summarizing the concrete functional change. Never use vague titles like `fix: update files` or `chore: cleanup`.
- **Body**: Explain **what** changed, **why** it was needed, **how** it was verified, and any compatibility/contract impacts.
- **Zero Secrets**: Never commit API keys, tokens, passwords, or `.env` files with credentials.

---

## 4. Self-Contained External Deliverables

All public deliverables (commits, PRs, issues, review replies, release notes, docs) must be independently understandable:

1. **Self-Contained Context**: External reviewers must be able to understand and verify the change without reading private chat logs, local drafts, or unpushed code.
2. **No Internal Plan or Stage Numbers**: Never cite internal milestone labels, section numbers from private plans, or phase tags (e.g., never write "complete phase 2" or "implement step 3.4").
3. **Code & Diff Perspective (Changed What & Why)**: Describe actual code changes, technical rationale, affected boundaries, and verification evidence.
4. **No Speculation**: Never describe unimplemented modules or unverified future plans as part of a commit or PR summary.

# Contributing to game-agent

Thank you for your interest in contributing to **game-agent**! All contributions—code, documentation, bug reports, feature proposals, and reviews—follow the repository engineering standards defined in [AGENTS.md](AGENTS.md) and [.agents/rules/](.agents/rules/README.md).

## 1. Language Policy

- This repository is **English-only** across source code, comments, file headers, documentation, commit messages, pull requests, and issues (unless explicitly implementing an `i18n` localization package).
- Dedicated `i18n` support will be added as a separate capability once the core TypeScript harness stabilizes.

## 2. Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js `>=24`
- **Package Manager**: `pnpm`

## 3. Getting Started

1. Fork the repository and clone your fork locally.
2. Create a dedicated task branch from the latest `main`:
   ```sh
   git checkout -b <type>/<kebab-case-description>
   ```
   Examples: `feat/bt-scheduler`, `fix/intent-ledger-timeout`, `docs/protocol-adapter`.
3. Never commit or push directly to `main`.

## 4. Commit Conventions

Commits must follow **Conventional Commits** in English:

```text
<type>(<scope>): <imperative description>
```

Allowed types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`, `build`, `ci`, `chore`, `revert`.
See [.agents/rules/git/commit-standards.md](.agents/rules/git/commit-standards.md) for full details.

## 5. Pull Request Workflow

1. Read and follow [.github/PULL_REQUEST_TEMPLATE/pull_request_template.md](.github/PULL_REQUEST_TEMPLATE/pull_request_template.md).
2. Keep changes minimal, decoupled, and self-contained—focus the PR description on **What**, **Why**, **Verification**, and **Compatibility / Breaking Changes**.
3. Run all applicable local checks before pushing (see [.agents/rules/testing/verification-and-testing.md](.agents/rules/testing/verification-and-testing.md)).
4. Address all CI failures and review threads cleanly; `main` accepts **squash merges** only.

## 6. Reporting Issues

1. Use [.github/ISSUE_TEMPLATE/general-issue.md](.github/ISSUE_TEMPLATE/general-issue.md).
2. Provide objective evidence (commit SHA, reproduction steps, logs, or specification references) and clearly distinguish verified facts from hypotheses.
3. For security vulnerabilities, do **not** open a public issue—follow [SECURITY.md](SECURITY.md).

# Naming, Comments, Language & File Header Conventions

This document defines naming standards, commenting style, English-only repository rules, and source file headers for **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Intent-Oriented Naming

### 1.1 Core Principles
- **Express Real Responsibility**: Name directories, files, classes, interfaces, types, functions, and variables neutrally and precisely according to domain boundaries and abstraction level.
- **Preserve Concrete Adapter Names**: Adapters should keep their real technical names (e.g., `HttpWsTransportAdapter`, `OpenAiCompatibleAdapter`) rather than vague wrappers.
- **TypeScript Idioms**: Use `PascalCase` for classes, interfaces, types, and enums; `camelCase` for variables, functions, and methods; `UPPER_SNAKE_CASE` for module constants; `kebab-case` for file and directory names.

### 1.2 Forbidden Names (Blacklist)
Never use vague, temporary, or subjective identifiers, including:
- `temp`, `tmp`
- `new_logic`, `old_logic`
- `quick_fix`, `hack`
- `helper2`, `test2`
- `MyManager`, `DataHandler`, `CommonUtil`

### 1.3 High-Risk Generic Terms
Avoid bare generic words unless paired with a clear domain qualifier or nested under a specific domain folder:
- **Generic terms to qualify**: `utils`, `helpers`, `common`, `shared`, `manager`, `service`, `handler`, `processor`, `controller`, `core`, `base`, `misc`, `data`, `logic`.
- **Correct**: `VisibilityFilter`, `IntentLedger`, `PromptInjectionGuard`, `ShardClusterOrchestrator`.
- **Avoid**: `Manager`, `Processor`, `DataHelper`, `Utils`.

---

## 2. Language, Comments & Self-Documenting Code

### 2.1 English-Only Policy (With Future i18n Readiness)
- **Strict English Default**: All code identifiers, string literals, error messages, comments, file headers, docs, commits, PRs, and default agent prompts must be written in clear **English**.
- **Prompt & Locale Separation**: Keep model prompt templates and user-facing strings isolated in dedicated prompt/locale resource modules so future `i18n` packs can be mounted cleanly without touching business logic.

### 2.2 Explain "Why", Not "What"
- Code structure and naming must clearly express **what** the code does.
- Comments should explain **why** (design trade-offs, non-obvious invariants, edge-case constraints, ordering requirements)—never narrate line-by-line execution.

### 2.3 Native Documentation Comments
- Use standard TSDoc/JSDoc (`/** ... */`) for exported APIs, interfaces, and non-obvious behaviors, including `@param`, `@returns`, `@throws` where helpful.

---

## 3. Core Source File Header Convention

Every hand-written source file (core domain packages, adapters, runtime apps, tests, scripts) must include a concise top-of-file TSDoc header defining three elements:

1. **Responsibilities**: The exact functional boundary and core task of the file.
2. **Contracts**: Required inputs/dependencies, output guarantees, and runtime assumptions.
3. **Constraints**: Dependency prohibitions, side-effect restrictions, and invariants.

Two kinds of packages use other header forms, both listed in `scripts/check-headers.ts`; the zero-leftover rules still apply to them:

- `HEADER_EXEMPT_PREFIXES` (currently the `kernel` group): no file header; every exported API is documented with TSDoc.
- `TSDOC_HEADER_PREFIXES`: each source file opens with a TSDoc module comment that describes the file; test files carry no header.

### Example (TypeScript)
```ts
/**
 * Responsibilities: Enforce 3-stage visibility cropping on inbound game payloads.
 * Contracts: Accepts raw server event type and payload; returns filtered data plus audit diffs.
 * Constraints: Stage order (whitelist -> coarsen -> budget) is immutable; never mutate input DTOs.
 */
```

### Independent Readability Rule
- File headers must be understandable to external contributors without access to private notes or internal tracking plans.
- Never link internal milestone IDs or untracked local documents inside file headers.

---

## 4. Objective Facts in Tracked Files

All Git-tracked files must remain strictly factual and neutral:
1. State only verifiable facts, contracts, and measured results—no hype, exaggeration, or filler.
2. Never reference untracked local files or private workspace paths outside the explicit `AGENTS.local.md` convention.

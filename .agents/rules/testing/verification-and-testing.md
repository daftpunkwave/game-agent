# Local Verification, Testing Standards & Delivery Criteria

This document defines change-scoped verification tiers, test quality rules, and delivery reporting standards for **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Change-Scoped Verification Tiers

Match local checks to the actual scope of your changes:

- **Documentation-Only Changes (`*.md`, docs)**:
  - Verify relative links, heading anchors, Markdown table column alignment, English-only compliance, and `git diff --check`.
  - Skip unrelated runtime unit/build suites.
- **Comments / File-Header-Only Changes (no executable changes)**:
  - Run type checking (`pnpm typecheck`) and boundary/header checks (`pnpm check:boundaries` when configured).
  - Skip full runtime test suites.
- **Runtime Code, Protocol, Bug Fix, or Refactor Changes**:
  - Run targeted unit/integration tests during iteration, then run the full repository check suite (`pnpm check`) after your final edit before pushing or merging.

### Delivery Evidence
Report only directly observed command outputs, exact test counts, and verified file paths. Never leave `TODO` placeholders, commented-out blocks, or debug logs behind.

---

## 2. Testing Standards

### 2.1 Strong Assertions & Anti-Fragile Design
- Assert concrete state transitions, filtered fields, intent states, and error paths—never rely on weak existence checks alone.
- Keep every test idempotent, isolated, and order-independent.
- Test real behavior across public ports (`Clock`, `Rng`, `TransportAdapter` stubs) rather than mocking private internals.

### 2.2 Core Coverage Dimensions
- **Happy Paths**: End-to-end BT tick, LLM decision loop, tool dispatch, and async push settlement.
- **Failure & Timeout Paths**: Transport errors, quota exhaustion, budget circuit breakers, and timeout reconciliation (`timeout_reconciling`).
- **Edge Cases**: Empty arrays, boundary numbers, schedule midnight wraparound, and concurrent turn guards.
- **Security Boundaries**: Prompt-injection blocking, 3-stage visibility stripping, and API key masking.

### 2.3 Never Weaken Failing Tests
When a test reveals a real defect in implementation code, fix the implementation—never relax or delete assertions to force a green build.

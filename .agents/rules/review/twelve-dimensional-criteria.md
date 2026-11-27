# Twelve-Dimensional Code Review Criteria

This document is the authoritative engineering review checklist for authoring, self-reviewing, and reviewing code in **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Correctness
- Verify business logic, state-machine transitions, async command/push reconciliation, edge bounds, concurrency ordering, and invariants match domain specifications and TypeScript contracts.

## 2. Edge Cases & Local Error Handling
- Guard `null`, `undefined`, empty collections, invalid enums, out-of-range numbers, `NaN`, timeouts, promise rejections, and cancellation (`AbortSignal`).
- **No Silent Swallowing**: Never write empty `catch {}` blocks. Ensure sockets, timers, file handles, and event listeners are deterministically released on error paths.

## 3. Security & Trust Boundaries
- Keep authentication, credential resolution, quota enforcement, visibility cropping, and prompt-injection filtering strictly inside trusted backend/gateway boundaries.
- Never hardcode secrets or mask failed validations with optimistic fallbacks.

## 4. API Contracts
- Keep public exports, HTTP/WS/MCP schemas, and DTOs explicit, minimal, and consistent (`null` vs `undefined` semantics), without leaking internal private types.

## 5. Decoupling & Single Responsibility
- Enforce decoupling over cohesion: changes in a game transport adapter or UI surface must not require modifying core BT, memory, or context packages.
- Avoid "god objects" and redundant wrapper shells (`wrapper hell`).

## 6. Dependency Governance
- Enforce a clean unidirectional dependency DAG across packages—no cycles, no deep internal imports, and third-party libraries isolated behind adapter boundaries.

## 7. Performance & Scalability
- Avoid unbounded in-memory arrays/maps, repeated deep cloning, redundant synchronous I/O, or per-turn prefix cache invalidation across high-density cluster deployments (thousands of concurrent agent sessions).
- Avoid speculative micro-optimizations that obscure correctness.

## 8. System Resilience
- External calls (LLM APIs, game sockets, MCP servers) must define timeouts, bounded retries with backoff, cancellation support, and graceful degradation when upstream dependencies stall.

## 9. Maintainability
- Minimize cognitive complexity, long functions, and unnamed magic constants. Extract shared helpers rather than duplicating non-trivial branches.

## 10. Intent-Oriented Naming
- Verify all identifiers follow [Naming & File Headers](../conventions/naming-and-headers.md) with zero blacklisted or vague names.

## 11. Documentation & Headers
- Ensure comments explain **why** rather than **what**, obsolete comments are removed, and hand-written source files contain accurate headers with the required `Responsibilities`, `Contracts`, and `Constraints` fields.

## 12. Testing Effectiveness
- Verify tests assert concrete state transitions and outputs (no weak `toBeDefined`-only checks), remain order-independent, avoid brittle internal mocks, and never weaken assertions to hide bugs.

## 13. Final Verification
- Run all change-scoped verification gates cleanly after the final edit before committing, pushing, or merging (see [Verification & Testing](../testing/verification-and-testing.md)).

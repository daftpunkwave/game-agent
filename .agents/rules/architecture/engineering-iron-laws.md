# Architecture Design & Core Engineering Iron Laws

This document defines mandatory architecture design, decoupling, security boundary, and dependency governance rules for **game-agent**, subordinate to [AGENTS.md](../../../AGENTS.md).

---

## 1. Core Engineering Principles

### 1.1 Evidence-Based Engineering
Base every architectural and debugging decision strictly on verified code, runtime behavior, dependency edges, and explicit contracts—never on speculation or unverified assumptions.

### 1.2 Four-Step Root-Cause Verification
Before fixing any issue, verify four items in sequence:
1. **Truthfulness**: Does the defect demonstrably exist?
2. **Impact**: What concrete behavior, invariant, or stability boundary is affected?
3. **Expected Contract**: What is the exact intended behavior and output contract?
4. **Root Cause**: Where is the cleanest, most fundamental fix location?

### 1.3 Minimal Precise Changes & Anti-Bloat
- Default to minimal, complete, targeted edits unless a task explicitly calls for a wider refactor.
- Preserve existing public contracts and module boundaries.
- Never pad code with redundant defensive branches, meaningless `try/catch` wrappers, empty passthrough interfaces, speculative caching, blind retries, or brittle mocks.

### 1.4 Zero Speculation & Zero Leftover Artifacts
- Never invent unverified APIs, package versions, or configuration flags. Inspect repository files first, official docs second, and ask maintainers when unclear.
- Strip all `console.log`, `debugger`, commented-out code, temporary mocks, and leftover `TODO`/`FIXME` markers before delivery.

---

## 2. Decoupling & Security Boundaries

### 2.1 Decoupling Over Cohesion (Fully Pluginized Kernel)
- **Plugin-First Architecture**: Not just memory or tools—every capability (Behavior Tree nodes, memory stores, context builders, LLM providers, protocol adapters, CLI/TUI/Web surfaces, game mode presets) operates behind explicit versioned contracts.
- **Plugin Kernel**: The kernel is the in-repo `@game-agent/kernel` package group, which owns service registration, scoped lifecycle, dependency injection, event dispatch, and reversible effects. Do not build a second kernel. Game-specific rules never live in the kernel group; any package may be a kernel plugin.
- **Explicit Composition**: Applications (CLI, terminal attach, Web, cluster worker) compose providers explicitly at their composition root.

### 2.2 Single Responsibility & Physical Isolation (SRP)
- Keep each file focused on a single cohesive responsibility. Split mixed domains physically regardless of line count.
- **No Wrapper Hell**: Never create shallow forwarding shells with no real logic.
- **File Size Guideline**: Keep source files at or below ~500 lines; split along natural domain seams when exceeded.

### 2.3 Dependency Inversion & Testability (DIP)
- Inject external capabilities (`Clock`, `Rng`, `IdGenerator`, `SecretStore`, `TransportAdapter`) explicitly via constructor or plugin context.
- **No Uncontrolled Side Effects in Core Logic**: Core algorithms (BT ticks, memory scoring, context assembly, visibility filtering, intent reconciliation) must never call `Date.now()`, `Math.random()`, `crypto.randomUUID()`, or read `process.env` directly—making deterministic testing effortless.

### 2.4 Single-Ingress / Single-Egress Game Protocol Boundary
- **One Exit (`EgressGateway`)**: All Behavior Tree action leaves and accepted model proposals must pass one outbound gateway (schema validation, quota limits, ledger recording, jitter) before reaching any `TransportAdapter`. Idempotency keys prevent duplicates only when the transport declares `honorsIdempotencyKey`; otherwise commands that spend resources are never resent automatically, and a send that fails mid-flight is recorded as `in-doubt`, not `failed`.
- **One Entry (`IngressGateway`)**: All game responses and push events must enter through one inbound gateway in a fixed order: intent ledger settlement, visibility cropping (whitelist, coarsen, budget), untrusted text tagging, inbox storage. Only then may they update the agent's blackboard or wake a step.
- **MCP Is One Transport**: MCP is an access protocol behind the `TransportAdapter` port, not the boundary itself. Event delivery must not depend on MCP server notifications.
- **No Backdoor Coupling**: Agent cognition, tools, and BT packages must never import transport sockets (`ws`, `http`, `net`) or game server internals directly. `pnpm check:boundaries` also keeps the cognition packages listed in `COGNITION_PACKAGES` (`behavior-tree`, `decision`, `agent-runtime`) free of Node file, process, and network modules.

### 2.5 Security & Trust Boundaries
- **Model Output Is Untrusted**: LLM output is an intent proposal, never authoritative game state; every command passes gateway and server validation.
- **Prompt Injection Defense**: External player chat, whispers, and mail must enter inside structured untrusted data slots and pass injection inspection—never interpolated into system instructions.
- **Visibility Cropping**: Never expose internal or preloaded server fields that a normal human player cannot observe on screen to any part of the agent's cognition: neither the model context nor the behavior tree's blackboard and conditions. Only the intent ledger may read raw correlation ids, and only to settle commands.
- **Secrets Stay Server-Side**: API keys and credentials are resolved at the backend/gateway boundary and masked in all UI/API views.

---

## 3. Dependency Governance

### 3.1 Unidirectional Dependency Tree
Package and module dependencies must form a strict Directed Acyclic Graph (DAG). Circular dependencies and upward imports are strictly forbidden.

### 3.2 Import & State Isolation
- **No Deep Imports**: Import packages only through their declared public entry points (`package.json` `exports`), never via internal relative paths like `@game-agent/pkg/src/...`.
- **No Shared Mutable Globals**: Share state only through explicit scoped services or immutable events.
- **Anti-Corruption Layers**: Wrap third-party LLM SDKs, MCP transports, and storage drivers inside dedicated adapter packages so vendor types never leak into core domain contracts.

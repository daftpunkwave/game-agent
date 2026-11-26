# Packages

Workspace packages live at `packages/<group>/<name>` and are published under the `@game-agent/` scope. Group rules are enforced by `pnpm check:boundaries`.

| Group | May depend on | Package | Responsibility |
|---|---|---|---|
| `util` | `util` | `errors` | Base error with a stable `code` |
| | | `deque` | Circular double-ended queue |
| | | `atomic-write` | Atomic file replacement |
| | | `ports` | `Clock`, `Rng`, `IdSource` and deterministic test implementations |
| `protocol` | `util`, `protocol`, `telemetry` | `contracts` | Game vocabulary, transport port, JSON schema subset |
| | | `intent-ledger` | Command lifecycle from issue to settlement |
| | | `inbox` | Cursor-addressed event inbox |
| | | `gateway` | Single ingress (settle, crop, tag, store) and single egress (validate, quota, record, jitter, send) |
| `telemetry` | `util`, `protocol` | `trace` | Trace records, filters, and sinks |
| `behavior` | `util`, `protocol` | `behavior-tree` | Tree format, validation, editing, scheduling, runner |
| `core` | `util`, `protocol`, `telemetry`, `behavior`, `core` | `decision` | Model port and bounded decision engine |
| | | `agent-runtime` | One agent as a headless game client |
| `llm` | `util`, `protocol`, `core` | `model-openai-compatible` | OpenAI-compatible Chat Completions adapter |
| `transport` | `util`, `protocol` | `transport-mcp` | MCP access (the only package that imports the MCP SDK) |
| | | `transport-simulated` | In-process simulated game |
| `fleet` | `util`, `protocol`, `behavior` | `fleet` | Profiles, template versions, rollout, audit, file storage |
| `boot` | `util`, `protocol`, `telemetry`, `behavior`, `core` | `app` | Cordis host service and per-agent scheduler |
| `bundle` | `util`, `protocol`, `behavior`, `boot` | `dsh` | DeepSeek Harness preset and `game_agent` tool |

Additional rules:

- `behavior` and `core` source must not import network, filesystem, or process modules.
- `@deepseek-ai/cordis` is imported only by `boot`, `bundle`, and `apps`; `@modelcontextprotocol/*` only by `transport`.
- Packages are imported through their entry point only; deep imports and undeclared dependencies are rejected.

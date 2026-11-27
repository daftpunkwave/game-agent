# Packages

Workspace packages live at `packages/<group>/<name>` and are published under the `@game-agent/` scope. Group rules are enforced by `pnpm check:boundaries`.

| Group | May depend on | Package | Responsibility |
|---|---|---|---|
| `kernel` | `kernel` | `kernel` | Services, scoped lifecycles, dependency injection, events, reversible effects |
| | | `kit` | Small general-purpose utilities |
| | | `schema` | Composable configuration schemas |
| | | `loader` | Loads and reloads plugins from configuration files |
| | | `include` | Includes and patches configuration files |
| | | `group` | Groups plugin entries in configuration |
| | | `timer` | Timers released with the owning plugin |
| | | `logger-console` | Console output for the kernel logger |
| | | `hmr` | Hot module replacement for plugins during development |
| `util` | `util` | `atomic-write` | Atomic file replacement and cross-process file locks |
| | | `brand` | Branded primitive types |
| | | `chunked-list` | Persistent append-only chunked lists with JSON checkpoints |
| | | `code-language` | File extension to syntax-highlighting language table |
| | | `crypto` | Browser-safe UUID and byte-encoding helpers |
| | | `deque` | Circular double-ended queue |
| | | `error` | `GameAgentError` base class with a stable `code` |
| | | `file-drag` | File drag names and native transfer requests |
| | | `home-paths` | Paths under the game-agent home directory |
| | | `http-proxy` | Process-wide outbound HTTP proxy policy |
| | | `launch-environment` | Launch environment that records which layer supplied each value |
| | | `lazy-require` | Lazy, cached loading of CommonJS dependencies |
| | | `output-retention` | Bounded retention that reports what was kept and what was omitted |
| | | `package-manifest` | Types for the `gameAgent` field of `package.json` |
| | | `ports` | `Clock`, `Rng`, `IdSource` and deterministic test implementations |
| | | `text-search` | Multilingual fuzzy filtering of in-memory lists |
| | | `time` | Instant and time-zone parsing, durations, Cron and RRULE recurrence |
| | | `timeout` | Timeout and deadline primitives |
| | | `values` | JSON and immutable-value helpers |
| | | `workspace-path` | Workspace paths, file addresses, and display helpers |
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
| `boot` | `kernel`, `util`, `protocol`, `telemetry`, `behavior`, `core` | `app` | Kernel host service and per-agent scheduler |

Additional rules:

- `behavior` and `core` source must not import network, filesystem, or process modules.
- Every group may import the `kernel` group; `kernel` imports nothing else from the workspace. `@modelcontextprotocol/*` is imported only by `transport`.
- Packages are imported through their entry point only; deep imports and undeclared dependencies are rejected.

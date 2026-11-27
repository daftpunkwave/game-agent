# Packages

Workspace packages live at `packages/<group>/<name>` and are published under the `@game-agent/` scope. Group rules are enforced by `pnpm check:boundaries`. The table below lists the game protocol and agent runtime packages, which follow the layer rules in the "May depend on" column; the [capability packages](#capability-packages) follow only the dependency rules.

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
- Packages are imported through the entries declared in their `exports`; other deep imports and undeclared dependencies are rejected. Tests may also use the test tooling in the root `devDependencies`.

## Capability packages

Capability packages are plugins of the kernel. They are constrained by declared dependencies, declared package entries, and the acyclic package graph; the layer rules above do not apply to them.

| Group | Package | Responsibility |
|---|---|---|
| `attachment` | `attachment` | Durable, immutable attachment storage interface |
| `boot` | `app-boot` | Boot sequence: `.env` loading, configuration resolution, loader guards |
| | `cmdline` | Immutable command-line handoff from the launcher to app plugins |
| | `hmr` | Coordinated hot reload of modules and profile configuration |
| | `config-editor` | Persist plugin configuration through profile patches |
| `core` | `agent` | Agent interface, registry, initiator scope, and event vocabulary |
| | `scope` | Scoped context registration and scope-filtered event dispatch |
| | `session` | Event-sourced session store |
| | `system-prompt` | System prompt section registry and assembly |
| `credentials` | `credentials` | Credential interface: settings hold references, providers hold values |
| | `credentials-local` | Credentials from `$GAME_AGENT_HOME/.env` under the process environment |
| | `authorization` | Flows that obtain a credential through a conversation with a person |
| `fs` | `fs` | File system interface: text I/O and optional version-guarded atomic writes |
| | `fs-local` | Local file system implementation |
| | `fs-observation-policy` | Read-before-edit and version-guarded writes over the file system interface |
| | `fs-patch` | Patch parser and line-ending-preserving text updater |
| `llm` | `llm` | Provider-neutral model service interface |
| | `llm-api-extensions` | Additive request-field registry for provider adapters |
| `native` | `native-system` | Locators for native helpers: the Linux Landlock launcher and exclusive file locks (no helper binaries are shipped yet) |
| `preset` | `persona` | Persona section composed into the system prompt |
| `ptc-runtime` | `ptc-runtime` | Programmatic tool-calling execution interface |
| `sandbox` | `sandbox` | Process sandbox interface and confinement vocabulary |
| | `sandbox-local` | Local sandbox backends: bubblewrap, the Landlock launcher, or the Windows ACL runner, probed before use |
| | `sandbox-windows-acl` | Windows write-restriction sandbox through restricted tokens and capability SIDs |
| `session` | `session-format` | Session storage format migration machinery |
| | `session-persistence` | Durable session persistence interface |
| | `session-projection` | Projections of per-session state derived from the session log |
| | `session-projection-cache` | Persisted projection checkpoints with throttled write-behind |
| | `session-stats` | Conversation counts and wall times per session |
| | `session-turn-outline` | Turn outline of a session |
| `settings` | `settings` | User settings interface |
| `shell` | `shell` | Shell executor interface |
| | `bash-local` | Local bash executor |
| | `pwsh-local` | Local Windows shell executor |
| `skill` | `skill` | Agent skill provider registry |
| `spill` | `spill` | Storage for oversized tool output, returning a retrieval locator |
| | `spill-local` | Session-scoped local files for spilled output |
| `storage` | `storage` | Storage hub: named backends and mounted data forms |
| | `storage-domain` | Schema-validated, event-emitting key-value domains |
| | `storage-json` | JSON file key-value backend |
| | `storage-sqlite` | SQLite key-value backend |
| `subprocess` | `subprocess` | Subprocess interface: managed process groups, bounded output, escalated kills |
| | `subprocess-local` | Local subprocess implementation, including pseudo-terminals |
| | `win32-process` | Win32 process, standard I/O, and job object primitives |
| `telemetry` | `otel` | OpenTelemetry log channels for ordinary events and session logs |
| `typert` | `typert-protocol` | Remote method metadata and provider protocols |
| | `typert-registry` | Runtime registry of generated reflection and schemas |
| `util` | `util-ripgrep` | Packaged ripgrep resolution and output streaming |
| `workspace` | `workspace` | Workspace registry: durable workspace records and session attachment |

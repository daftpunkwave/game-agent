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
| | `attachment-local` | Private content-addressed attachment storage in the game-agent home, with image normalization |
| `boot` | `app-boot` | Boot sequence: `.env` loading, configuration resolution, loader guards |
| | `cmdline` | Immutable command-line handoff from the launcher to app plugins |
| | `config-editor` | Persist plugin configuration through profile patches |
| | `hmr` | Coordinated hot reload of modules and profile configuration |
| `compaction` | `command-compact` | Command that compacts a session on request |
| | `compaction` | Context compaction interface |
| | `compaction-basic` | Token-driven compaction policy with model summarization |
| | `compaction-image-offload` | Replaces over-budget request images with placeholders and retries |
| | `compaction-tool-result-pruner` | Model-free pruning of tool results |
| `context` | `agent-instructions` | Loads `AGENTS.md` and `CLAUDE.md` instruction files into the context |
| | `file-reference` | File reference discovery and the shared `@file` grammar |
| | `file-reference-local` | Local file reference provider with bounded fuzzy indexes |
| | `session-reference` | References to other sessions as untrusted model context |
| | `time-context` | Per-step context with the current and elapsed time |
| `core` | `agent` | Agent interface, registry, initiator scope, and event vocabulary |
| | `agent-default-model` | Default model selection shared by agent entry points |
| | `agent-loop` | Agent loop: turns, steps, model requests, and tool calls |
| | `scope` | Scoped context registration and scope-filtered event dispatch |
| | `session` | Event-sourced session store |
| | `system-prompt` | System prompt section registry and assembly |
| | `tool-executor-native` | Native tool execution |
| | `tool-executor-ptc` | Programmatic tool-calling programs: tool bindings and generated SDK prompts |
| | `tools` | Tool registry and execution pipeline |
| `credentials` | `authorization` | Flows that obtain a credential through a conversation with a person |
| | `credentials` | Credential interface: settings hold references, providers hold values |
| | `credentials-local` | Credentials from `$GAME_AGENT_HOME/.env` under the process environment |
| `feedback` | `command-feedback` | Command that records session feedback in the session log |
| | `message-feedback` | Ratings and notes on assistant messages, kept in the session log |
| `fs` | `fs` | File system interface: text I/O and optional version-guarded atomic writes |
| | `fs-local` | Local file system implementation |
| | `fs-observation-policy` | Read-before-edit and version-guarded writes over the file system interface |
| | `fs-patch` | Patch parser and line-ending-preserving text updater |
| | `fs-sandbox` | File system that confines writes and edits by the sandbox mode of each call |
| | `tool-fs` | Read, write, and edit tools over the file system interface |
| | `tool-fs-search` | Glob and grep tools backed by the packaged ripgrep |
| | `tool-str-replace-editor` | View, create, replace, and insert editing tool |
| `guard` | `repeat-tool-reminder` | Reminds the agent when it repeats identical tool calls |
| | `timeout-policy` | Per-tool deadlines for tool calls |
| `identity` | `anonymous-user-id` | Random identifier of one installation, kept in the game-agent home |
| `interaction` | `commands` | Registry of human commands contributed by plugins |
| | `permission-presets` | Permission presets that bundle the sandbox mode and approval policy |
| | `tool-ask-user` | Tool that asks the person a question |
| | `user-approval` | One-shot approval decisions, denied unless an answerer allows them |
| | `user-questions` | Interface for asking the person questions during a run |
| `jobs` | `jobs` | Background job registry: ids, owner isolation, polling, cancellation |
| | `jobs-local` | Process-local background job registry |
| | `tool-jobs` | Tools to read, list, and stop background jobs |
| `llm` | `llm` | Provider-neutral model service interface |
| | `llm-api-extensions` | Additive request-field registry for provider adapters |
| | `llm-messages` | Messages API adapter: request translation, streaming, Files API image upload, and model listing |
| | `llm-messages-api-key` | API-key route for the Messages API: credentials and discovery of configured models |
| | `llm-retry` | Retry policy for model requests, routed by provider |
| | `messages-auth` | Releases the API key of a model route for each provider request |
| | `token-meter` | Replay-aware token measurement |
| `native` | `native-system` | Locators for native helpers: the Linux Landlock launcher and exclusive file locks (no helper binaries are shipped yet) |
| `preset` | `agent-preset` | Declares an agent capability composition in configuration |
| | `agent-preset-registry` | Preset registry with profile-backed editing |
| | `persona` | Persona section composed into the system prompt |
| `ptc-runtime` | `ptc-runtime` | Programmatic tool-calling execution interface |
| | `ptc-runtime-node` | Node.js evaluators for programmatic tool calling, with optional retained state |
| `sandbox` | `sandbox` | Process sandbox interface and confinement vocabulary |
| | `sandbox-local` | Local sandbox backends: bubblewrap, the Landlock launcher, or the Windows ACL runner, probed before use |
| | `sandbox-policy` | Per-call sandbox policy from deployment defaults and each session's mode and workspace |
| | `sandbox-windows-acl` | Windows write-restriction sandbox through restricted tokens and capability SIDs |
| `session-query` | `session-query` | Session query interface: reads, traces, and filters |
| | `session-query-sqlite` | Session query backend with SQLite full-text search |
| | `tool-session-list` | Read-only workspace and session listing tools |
| `session` | `session-checkpoint-policy` | Durability checkpoints before model requests and tool side effects |
| | `session-format` | Session storage format migration machinery |
| | `session-format-catalog` | Catalog of session format codecs and migrations |
| | `session-format-v0-to-v1` | Session format versions 0 and 1 and the migration to 1 |
| | `session-format-v1-to-v2` | Session format version 2 and the migration to 2 |
| | `session-format-v2-to-v3` | Migration of session artifacts to format version 3 |
| | `session-format-v3-to-v4` | Migration of session artifacts to format version 4 and delivery validation |
| | `session-persistence` | Durable session persistence interface |
| | `session-persistence-jsonl` | JSONL session store |
| | `session-persistence-sqlite` | SQLite session store |
| | `session-projection` | Projections of per-session state derived from the session log |
| | `session-projection-cache` | Persisted projection checkpoints with throttled write-behind |
| | `session-stats` | Conversation counts and wall times per session |
| | `session-telemetry` | Session event capture, redaction, and handoff to a reporting backend |
| | `session-telemetry-otel` | Session logs over OpenTelemetry, sent only when sharing is enabled |
| | `session-title` | Session titles derived from the log, with pluggable title providers |
| | `session-turn-outline` | Turn outline of a session |
| | `working-directory` | Session working directories with durable changes and model context |
| `settings` | `settings` | User settings interface |
| `shell` | `bash-local` | Local bash executor |
| | `bash-sandbox` | Bash executor that confines every command through the sandbox |
| | `pwsh-local` | Local Windows shell executor |
| | `shell` | Shell executor interface |
| | `shell-env` | Managed `GAME_AGENT_*` shell environment registry |
| | `tool-bash` | Bash tool with optional background jobs and sandbox escalation |
| | `tool-bash-persistent` | Persistent bash tool backed by a pseudo-terminal session |
| | `tool-pwsh` | Windows shell tool over the shell executor interface |
| | `tool-pwsh-persistent` | Persistent Windows shell tool backed by a pseudo-terminal session |
| `skill` | `skill` | Agent skill provider registry |
| `spill` | `spill` | Storage for oversized tool output, returning a retrieval locator |
| | `spill-local` | Session-scoped local files for spilled output |
| | `spill-policy` | Token-budgeted retention of tool results with recoverable paths |
| `storage` | `storage` | Storage hub: named backends and mounted data forms |
| | `storage-domain` | Schema-validated, event-emitting key-value domains |
| | `storage-json` | JSON file key-value backend |
| | `storage-sqlite` | SQLite key-value backend |
| `subprocess` | `subprocess` | Subprocess interface: managed process groups, bounded output, escalated kills |
| | `subprocess-local` | Local subprocess implementation, including pseudo-terminals |
| | `win32-process` | Win32 process, standard I/O, and job object primitives |
| `telemetry` | `otel` | OpenTelemetry log channels for ordinary events and session logs |
| `terminal` | `terminal` | Persistent pseudo-terminal session interface |
| | `terminal-bash` | Persistent shell pseudo-terminal backend |
| `test-support` | `agent-loop-testkit` | Agent loop drivers and inbox doubles for tests |
| | `llm-mock-server` | Scriptable model HTTP server with injectable faults for recovery tests |
| | `llm-replay` | Replays model output recorded in a session log, for tests without a model key |
| | `loader-smoke` | Runtime for smoke tests of real configuration loading |
| | `session-snapshot` | Session log snapshots with output normalization for tests |
| | `tool-testkit` | Tool definition and execution fixtures for tests |
| `todo` | `tool-todo` | Todo list tool over the session log |
| `typert` | `typert-protocol` | Remote method metadata and provider protocols |
| | `typert-registry` | Runtime registry of generated reflection and schemas |
| `util` | `util-ripgrep` | Packaged ripgrep resolution and output streaming |
| `workspace` | `workspace` | Workspace registry: durable workspace records and session attachment |

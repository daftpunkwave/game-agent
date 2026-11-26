# Architecture

This document describes the contracts between game-agent's layers as implemented in this repository. Package-level details live in each package's source headers; the package index is [packages/README.md](../packages/README.md).

## 1. The agent is a headless game client

An agent holds a game connection the way a player's client does: it sends commands, receives server-initiated events, and reads the screens a player could open. It does not render anything. Everything an agent knows about the world arrives through one inbound gateway, and everything it does leaves through one outbound gateway.

```text
TransportAdapter ──raw events──▶ IngressGateway ──AgentEvent──▶ EventInbox ──▶ TreeRunner / DecisionEngine
TransportAdapter ◀──GameIntent── EgressGateway ◀──ProposedCommand── TreeRunner (action) / DecisionEngine (proposal)
```

## 2. Transport adapters

`TransportAdapter` (in `@game-agent/contracts`) is the only port to a game. It declares capabilities instead of hiding them:

| Capability | Meaning | Runtime consequence |
|---|---|---|
| `honorsIdempotencyKey` | The server deduplicates commands by key | Without it, nothing that spends resources is ever resent |
| `deliversEvents` | Server-initiated events reach the adapter | Without it, the agent learns only from snapshots and command queries |
| `canPauseGameTime` | The game clock can stop while the agent decides | Local mods only; online games must rely on rules for time-critical reactions |

Implemented adapters:

- `transport-mcp` maps MCP tools to actions. Receipts follow a structured-content convention (`receipt: accepted | rejected | completed`, `correlationId`, `expectedSettleAt`). Events are optional and pulled through a configured events tool with a cursor; status queries go through a configured status tool. MCP server notifications are not relied on for event delivery, because they carry no payload and are not redelivered after a broken stream.
- `transport-simulated` is a small in-process game used for tests and accelerated simulation. It includes a hidden `intel` view that visibility policies must remove.

## 3. Ingress: settle, crop, tag, store

`IngressGateway.accept` runs four stages in a fixed order:

1. **Settle.** `IntentLedger.settleFromEvent` matches the raw event to an accepted intent by server-issued correlation id only. Unmatched events are external facts, including results of actions a human operator took during a takeover.
2. **Crop.** `cropFields` applies the visibility policy: whitelist fields, coarsen values (`bucket`, `bands`, `significant`), then apply size budgets. Unlisted views and event types are removed entirely. The order is fixed so that cost limits can never remove a field before correctness decides whether it is visible.
3. **Tag.** Player-authored text becomes `UntrustedText` with heuristic flags such as `claims-authority` and `requests-assets`. Flags are inputs for rule nodes (for example, gating resource transfers); they are not a security boundary.
4. **Store.** The event enters the agent's `EventInbox` with a monotonic cursor; duplicates by event id are dropped and overflow is counted.

`IngressGateway.observe` crops snapshots the same way. The runtime mirrors cropped fields into the blackboard as `<view>.<field>`, so rule nodes and the model see the same player-visible world.

## 4. Egress: validate, quota, record, jitter, send

`EgressGateway.dispatch` refuses unknown actions, invalid arguments, and exhausted daily quotas before anything reaches the game. Accepted commands are recorded in the ledger, delayed by a jitter drawn from the injected random source, sent, and updated with the receipt. If sending throws, the intent becomes `in-doubt`: the game may or may not have executed it, so it is never marked failed and never retried automatically.

## 5. Intent ledger

```text
recorded ─▶ sent ─▶ accepted ─▶ succeeded | failed
   │          │        └─▶ overdue ─▶ (query) accepted | succeeded | failed | unknown
   │          ├─▶ succeeded (completed receipt) | rejected
   │          └─▶ in-doubt ─▶ succeeded | failed | unknown
   └─▶ rejected (cancelled before send)
```

Deadlines come from the game's expected settle time plus a grace of `max(graceMs, graceRatio × expected duration)`. Overdue intents are reconciled through `TransportAdapter.queryCommand` when the game offers it.

## 6. Behavior tree on the agent side

- **Format.** `game-agent.tree/v1` JSON with an id and an integer version. Node paths (`root/0/2`) address nodes for editing, tracing, and runtime state.
- **Validation.** `validateTreeDefinition` reports every problem with its path and can check condition and action names against catalogs.
- **Editing.** `replaceNode`, `insertChild`, and `removeNode` return a new definition with the version incremented. Editors (CLI today, web and desktop later) share these operations.
- **Execution.** `TreeRunner.tick` is synchronous. Actions and decisions start asynchronous work through `TreeHost` and are polled by handle, so a command accepted now and settled forty minutes later keeps its node `running` the whole time. `wakeAt` reports the next timer-driven change (cooldowns, schedule boundaries, wait timeouts) so schedulers never busy-poll.
- **Replacement.** `AgentRuntime.replaceTree` swaps a tree into a running agent; node state and cooldowns reset, commands already sent stay tracked by the ledger.

## 7. Bounded decisions (AI nodes)

A `decision` node calls `DecisionEngine.decide` exactly once with: a fixed system prefix (base rules plus game rules, stable for prefix caching), the tools named by the node sorted by name, the cropped observation, recent inbox events, and player messages in a separate section labelled as untrusted data. Tool calls are proposals: the engine rejects tools that were not offered, invalid arguments, and anything beyond `maxProposals`; accepted proposals go through the egress gateway like any other command. Token usage, including cached input, is accumulated per agent.

`ModelAdapter` is the only port to a model provider. `model-openai-compatible` implements it for any OpenAI-compatible Chat Completions endpoint; `ScriptedModelAdapter` serves tests and simulations.

## 8. Composition and scheduling

The kernel is Cordis (`@deepseek-ai/cordis`). `GameAgentHost` is a Cordis service registered as `ctx.gameAgents`; it starts agent runtimes and gives each an `AgentScheduler` that:

- steps immediately when the runtime reports new events or finished work,
- otherwise steps at the tree's `wakeAt` or at a heartbeat, whichever comes first,
- never runs two steps of the same agent at once,
- backs off exponentially after failures and reports them as `fault` traces, so one faulty agent does not stall the others in its process.

Unloading the plugin stops every agent it started.

## 9. Local play inside DeepSeek Harness

`@game-agent/dsh-bundle` is a Cordis plugin loaded through a DeepSeek Harness profile. It registers a `game-agent` session preset built from the base preset's plugin rows plus the game connection rows (for example DeepSeek Harness's MCP client pointed at a local game), and a `game_agent` tool for inspecting agents and validating or outlining trees. Choosing the preset when starting a new conversation creates a game-playing session. The bundle has been verified against Cordis with stand-ins for the preset and tool services, not yet against a running DeepSeek Harness build.

## 10. Fleet operations

`@game-agent/fleet` keeps a plain JSON document of agent profiles and published tree templates:

- **Profiles** carry realm, account reference, pinned tree version, persona (risk appetite, language, daily message budget, goal weights), active-hour windows, and spending limits for premium currency.
- **Lifecycle** commands: batch create, pause, resume, release (the account returns to ordinary player control), and takeover leases for human operators.
- **Templates** are immutable once published. Rollout is `pinned` by default; `staged` moves a stable, hash-selected percentage of agents to a newer version, so one bad edit never reaches every agent at once.
- **Audit.** Every mutating command records operator, action, affected agents, and details.

## 11. Observability

Every gateway stage, node outcome, decision, reconciliation, and fault produces a `TraceRecord` with an agent id, a category (`tick`, `intent`, `settlement`, `ingress`, `decision`, `operator`, `fault`), game-defined tags (for example `resource-gain`, `combat`, `spending`), and structured details. Sinks keep records in memory or append them to JSON Lines files; `filterTrace` selects by agent, category, tag, and time.

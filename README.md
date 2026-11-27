# game-agent

**A game agent is a game client without a screen.**

game-agent is an open runtime for language-model agents that play real games through the game's own interface: the same commands, the same rules, and the same information a human player has. Give it an adapter for a game, whether an MCP server exposed by a local mod or the client protocol of an online game server, and it runs an agent that connects, watches, decides, and acts like a player without rendering a single frame.

It is built for the moment game AI stops being scripted NPC behavior and becomes a participant: an agent that holds an account, keeps its word, remembers who helped it, sleeps at night, and still reacts when its city is attacked at 3 a.m.

> **Status: early development.** The runtime core, behavior tree engine, gateways, simulated game, MCP transport, fleet model, plugin kernel, and CLI are implemented and covered by tests. Terminal attach, the web console, and the desktop app are on the roadmap. Interfaces will change.

## Why a new runtime

Putting a model in front of a game API is easy. Making that model a credible player is a different problem, because real games break naive agents in three ways.

1. **What matters most is pushed, not requested.** Being scouted, attacked, or called for help arrives as server events with no request attached. Every game-agent agent has a cursor-addressed inbox fed by its transport. Request–response channels such as MCP carry actions; they are not trusted with the event stream.
2. **A command's reply is not its result.** `accepted` means queued; the battle resolves forty minutes later. Every command enters an intent ledger and settles only when the game reports the outcome, matched by server-issued ids. Overdue commands are reconciled by query, never resent blindly, and a send that fails mid-flight is recorded as *in doubt*, not as failed.
3. **The model cannot sit on the hot path.** A local mod can pause the game while the model thinks; an online server cannot. game-agent puts an editable behavior tree on the agent side: routines run as rules at zero token cost, and the model is consulted only at explicit AI nodes, once per wake-up, with a narrowed set of tools.

One rule governs all of it: **an agent sees only what a player sees.** Every snapshot and event passes a three-stage crop (field whitelist, then value coarsening, then size budget, in that order) before it reaches either the tree or the model. Text written by other players enters as tagged, untrusted data and can never become an instruction.

## Architecture

```text
Game (local mod | online game server)
  ⇅  Transport adapter   MCP · simulated game · per-game WebSocket/HTTP adapters
  ⇅  Gateway             ingress: settle intents → crop to player-visible → tag player text → inbox
                         egress:  validate → quota → record in ledger → jitter → send
  ⇅  Agent runtime       behavior tree ticks on events and timers; AI nodes run bounded model decisions
  ⇄  Control plane       CLI today · terminal attach, web console, desktop next
```

- **MCP is one way in, not the architecture.** It is a good fit for local mods and game-server bridges that expose tools. Online games with their own client protocol get a transport adapter that speaks that protocol directly. Both sit behind the same `TransportAdapter` port.
- **The behavior tree lives on the agent side and is data.** Trees are versioned JSON, validated with node-level error paths, edited through immutable path-addressed operations, and hot-swapped into a running agent.
- **Everything is a plugin.** The in-repo kernel composes every capability as a plugin with a scoped lifecycle and reversible effects, so the same packages run in a single local process and in a server shard.

## Two ways to run

| | Local | Cluster |
|---|---|---|
| Who | One player on one machine | An operator running many agents on servers |
| Entry | `game-agent run` | `game-agent` CLI, headless; no graphical front end |
| Game connection | Usually the game's local MCP server | Per-game transport adapter |
| Brain | Behavior tree autopilot plus the conversation model | Behavior tree plus bounded AI nodes |
| Operations | Inspect and validate trees from the conversation | Fleet file: profiles, batch create and release, takeover leases, spending limits, staged tree rollout, audit log |

Each hosted agent has its own single-flight scheduler: it steps on new events, at the tree's next timer, or at a heartbeat, and a failing agent backs off without stalling the others in its process.

## Quick start

Requires Node.js 24 or newer and pnpm.

```sh
pnpm install
pnpm build

# Check and inspect a behavior tree
pnpm game-agent tree validate examples/simulated-farm/tree.json
pnpm game-agent tree outline examples/simulated-farm/tree.json

# Run eight in-game hours against the built-in simulated game on an accelerated clock
pnpm game-agent simulate --tree examples/simulated-farm/tree.json --hours 8 --step-minutes 5 --category decision,settlement

# Manage a fleet
pnpm game-agent fleet publish --file .game-agent/fleet.json --tree examples/simulated-farm/tree.json
pnpm game-agent fleet create --file .game-agent/fleet.json --template simulated-farm@1 --count 3 \
  --region qa --server s1 --account pool-a --risk conservative --active 08:00-12:00,19:00-23:00
pnpm game-agent fleet list --file .game-agent/fleet.json

# Play a local game that exposes MCP (edit the example first)
MODEL_API_KEY=... pnpm game-agent run --config examples/local-mcp-game/agent.json
```

The simulation is deterministic for a given tree, seed, and duration. Its AI nodes use a scripted placeholder model, so it validates the rule layer and the plumbing, not model judgment.

## Behavior trees are data

```json
{
  "format": "game-agent.tree/v1",
  "id": "simulated-farm",
  "version": 1,
  "root": {
    "type": "selector",
    "children": [
      { "type": "sequence", "name": "upgrade when affordable", "children": [
        { "type": "condition", "check": "blackboard.atLeastKey", "args": { "key": "city.wood", "minKey": "city.upgradeCost" } },
        { "type": "action", "action": "upgrade_farm", "args": {} }
      ] },
      { "type": "cooldown", "ms": 3600000, "child":
        { "type": "decision", "purpose": "Decide whether anything is worth doing.", "tools": ["gather", "say"], "maxProposals": 1, "timeoutMs": 30000 } }
    ]
  }
}
```

| Family | Node types |
|---|---|
| Composites | `sequence`, `selector`, `parallel` |
| Decorators | `inverter`, `cooldown`, `schedule` (daily active windows) |
| Leaves | `condition`, `action` (waits for settlement, not the receipt), `decision` (AI node), `wait-event`, `set` |

Visible game state is mirrored into the blackboard as `<view>.<field>` after cropping, so rules and the model read the same player-visible world.

## Repository map

| Group | Packages | Responsibility |
|---|---|---|
| `kernel` | `kernel`, `kit`, `schema`, `loader`, `include`, `group`, `timer`, `logger-console`, `hmr` | Plugin kernel, configuration schemas, configuration loading, plugin-scoped timers, console logging, hot reload |
| `storage`, `credentials`, `attachment`, `subprocess`, `session`, `typert`, `fs` | see [packages/README.md](packages/README.md#capability-packages) | Storage backends, credential references, attachments, managed subprocesses, session store and formats, remote method metadata |
| `util` | `error`, `deque`, `atomic-write`, `time`, `timeout`, `home-paths`, `http-proxy`, `values`, `ports`, and others (see [packages/README.md](packages/README.md)) | Building blocks: errors, collections, file and path helpers, time and timeouts, outbound proxy policy, and injected time, randomness, and ids |
| `protocol` | `contracts`, `intent-ledger`, `inbox`, `gateway` | Game vocabulary, command lifecycle, event inbox, single ingress and egress |
| `behavior` | `behavior-tree` | Tree format, validation, editing, scheduling, runner |
| `core` | `decision`, `agent-runtime` | Bounded model decisions and the single-agent runtime |
| `llm` | `model-openai-compatible` | Adapter for any OpenAI-compatible Chat Completions endpoint |
| `transport` | `transport-mcp`, `transport-simulated` | MCP access and an in-process simulated game |
| `telemetry` | `trace` | Structured trace records, filters, memory and JSON Lines sinks |
| `fleet` | `fleet` | Agent profiles, template versions, rollout, operator audit |
| `boot` | `app` | Kernel host service and per-agent scheduler |
| `apps` | `cli` | The `game-agent` command line |

See [docs/architecture.md](docs/architecture.md) for contracts between layers and [packages/README.md](packages/README.md) for the package index.

## Roadmap

- TUI for live fleet monitoring, then a web console and a desktop app.
- Durable inbox and ledger stores with restart recovery.
- A WebSocket/HTTP transport template for online games.
- Recorded-decision replay for evaluating AI nodes offline.
- Persona sampling and human-likeness parameters (response latency, attention, deliberate imperfection).

## Responsible use

Use game-agent only with games you own, operate, or are permitted to automate. When agents interact with real players, follow the AI disclosure rules that apply to your players and your jurisdiction.

## Contributing

Read [AGENTS.md](AGENTS.md), [.agents/rules/](.agents/rules/README.md), and [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md). Community standards are in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

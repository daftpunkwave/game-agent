# game-agent

A universal **TypeScript (Node.js 24+)** game AI agent runtime harness. Connect any game API or MCP server to drive **AI-NPCs**, **AI factions**, and **autonomous gameplay**—featuring a built-in **Behavior Tree**, structured memory, single-ingress/single-egress protocol boundaries, and headless CLI/TUI cluster monitoring.

## Core Design Principles

1. **Protocol-Agnostic Game Client Model**
   ```text
   Game Interface (Local Mod / Online Game Server)
     -> MCP / Single-Port Protocol Boundary (Ingress & Egress)
       -> game-agent Runtime (Behavior Tree + Memory + Bounded LLM Loop)
         -> Operator / Player (CLI/TUI, Web Console, Desktop, or Harness Preset)
   ```
   Every inbound packet and outbound command passes through one explicit protocol boundary (`SingleIngress` / `SingleEgress`), keeping game transport adapters completely decoupled from agent cognition.
2. **Behavior Tree + Bounded LLM Hybrid Execution**
   High-frequency deterministic routines, sleep schedules, and resource management execute locally in the agent-side Behavior Tree at zero token cost. LLM calls are invoked only at explicit AI decision nodes with bounded tool loops and prefix-cache-aligned context assembly.
3. **Dual Deployment Shapes**
   - **Local Interactive Mode**: Launch via CLI/TUI, Web console, or compatible harness preset to start a conversation and spawn a live game agent.
   - **Headless Server Cluster Mode**: Deploy thousands of sharded agents across servers via CLI/TUI with zero game UI overhead, strict daily quotas, and on-demand raw trace inspection.
4. **English-First Repository**
   All code, comments, documentation, commits, issues, and pull requests in this repository are maintained in **English**. Dedicated `i18n` localization support will be introduced separately.

## Repository Standards & Governance

- [AGENTS.md](AGENTS.md) — Mandatory coding agent specification and universal engineering iron laws
- [.agents/rules/](.agents/rules/README.md) — Specialized rules for architecture, naming, Git/PR lifecycle, Issue triage, code review, and testing
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution workflow, branch naming, and commit conventions
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Community behavior standards
- [SECURITY.md](SECURITY.md) — Security boundary and vulnerability disclosure policy

## License

[MIT](LICENSE)

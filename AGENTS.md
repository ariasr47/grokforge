# Spire OS — multi-provider workspace

This consumer has Spire Tech installed for every supported host. Shared project state lives only under
`.spire/clusters/tech/`. Provider roots hold framework bytes and host adapters — not product memory.

| Host | Root | Boot |
|------|------|------|
| claude | `.claude/` | `.claude/ORCHESTRATOR.md` via `/spire-tech` |
| codex | `.codex/` | `.codex/AGENTS.md` via `$spire-tech` |
| grok | `.grok/` | `.grok/AGENTS.md` via `$spire-tech` |

Open the matching host and use its launch adapter. Do not copy contracts or context into provider trees.

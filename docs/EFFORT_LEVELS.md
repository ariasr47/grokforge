# What Chat effort levels actually do

Shell chips map to **model choice** and/or **API `reasoning_effort`** in the host (`apps/host/src/effort.ts`).

| UI chip | Model path | `reasoning_effort` | What you’ll notice |
|---------|------------|--------------------|--------------------|
| **Auto** | Your Settings model (e.g. `grok-4.5`) | *not set* (model default) | Balanced; grok-4.5 often still reasons by default |
| **Fast** | Prefers `grok-4-fast-non-reasoning` / `grok-4-fast` | `low` | Snappier; less deep think |
| **Expert** | Settings model unchanged | `high` | Deeper think; **can sit silent longer** before first token |
| **Heavy** | Prefers `grok-4` (or env override) | `high` | Longest / hardest; more wait |

## Why it felt “stuck”

For many turns the agent uses a **non-streaming** model call first (so it can assemble tool calls). During that wait there is **no answer text** until the API returns. Expert/Heavy + reasoning can take tens of seconds.

## Think aloud

When the API returns **reasoning / thinking** summaries, the shell shows a collapsible **Thinking** block and a live status bar with phase + elapsed time.

## Screenshot (Win+PrtScn)

That does **not** intentionally cancel a run. Focus/WebSocket can blip; the UI now says **connection interrupted / reconnecting** instead of looking like a silent cancel. A real cancel shows **“Run cancelled”** toast + footer.

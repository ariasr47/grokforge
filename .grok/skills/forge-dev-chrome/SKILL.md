---
name: forge-dev-chrome
description: Drive Forge Dev (:5174 / host :8788) through Chrome DevTools without wait_for or inline take_snapshot — those poison the MCP pipe and stall this TUI for 100 minutes.
---

# Forge Dev Chrome

Use when calling `chrome-devtools` against Forge Dev (`http://127.0.0.1:5174/`, banner host `:8788`), including `/goal` from `docs/FORGE_EVER_GOAL.md`.

Canon: that file’s **CHROME-MCP STALL LAW**. This skill is the tool-level remainder compact must not drop.

## Do

1. Glance with `evaluate_script`, `waitForStableDom: false`. Return a small JSON object only (`gate`, `waiting`, `yourTurn`, `banner`).
2. Need click uids: `take_snapshot` with `filePath` under scratch. Never `verbose`. Never omit `filePath`.
3. `click` / `fill` with `includeSnapshot: false`.
4. If a chrome-devtools call is still running after ~15s, or `mcp_transport_decode_error` appears: issue **zero** further chrome-devtools calls this session. Read `host.log` and `GET http://127.0.0.1:8788/api/health`. Tell the operator this TUI session must restart to unwedge Chrome MCP (host deadline is 6000s).

## Do not

- `wait_for` on Forge Dev (always attaches a snapshot).
- Inline `take_snapshot` (no `filePath`) on a live run.
- A second chrome-devtools call while one is in-flight.
- `npm run host:dev` / `dev:ui` as a command you wait to exit. Attach the pid from `/api/health`.

# Grok Code Shell — Implementation Spec

**Status:** Draft v0.2  
**Priority:** Grok-first (Codex / Claude Code later)  
**Related:** `docs/design.html`

---

## 1. Goal

Build a **local desktop coding agent** optimized for **Grok**, because Claude and ChatGPT already have strong official GUIs/CLIs.

**v1 product one-liner:**  
Open a repo, talk to Grok, approve tools, review diffs — default billing on **SuperGrok sub-pool**, **API key** as fallback.

**North star (v2):** same shell hosts Codex and Claude Code via ACP without rewriting the UI.

---

## 2. Why Grok-first

| Provider | Existing coding GUI/CLI | Our v1 focus |
|----------|-------------------------|--------------|
| Claude | Claude Code | Later (ACP adapter) |
| OpenAI | Codex / ChatGPT surfaces | Later (ACP adapter) |
| Grok | Gap for local-repo agent UX | **Now** |

---

## 3. In scope / out of scope

### In scope (v1)

- Open local workspace folder
- Streaming chat transcript
- ACP client host + `grok-acp` agent process
- Tools: read, list/grep, apply patch, shell
- Permission prompts for write/shell
- Diff accept/reject
- Auth: SuperGrok OAuth (sub-pool) + `XAI_API_KEY` fallback
- Workspace path confinement

### Out of scope (v1)

- Codex / Claude integration (design only)
- Full IDE features (LSP, debug, rich git UI)
- Multi-user subscription sharing
- Scraping grok.com
- Cloud sync of projects

---

## 4. Architecture

```
Shell UI (Vite/React :5173)
    → Host (Node :8787 HTTP+WS)
        → ACP client (stdio JSON-RPC)
            → grok-acp (child process, cwd=workspace)
                → xAI (Grok Build / API key)
                → local tools (read/grep/write/shell)
```

Later:

```
Same ACP client → codex-acp | claude-agent-acp
```

---

## 5. Auth specification

### Modes

| Mode | Credential | Billing |
|------|------------|---------|
| `sub_pool` (default after M4) | OAuth PKCE tokens | SuperGrok / product weekly pool |
| `api_key` | `XAI_API_KEY` | console.x.ai pay-per-token |

### Rules

1. Implement **API key path first** (M1) so development is unblocked.
2. Add OAuth and switch **default UX** to sub-pool (M4).
3. On pool/rate-limit errors, UI must offer “Switch to API key” without crashing.
4. Store secrets in OS keychain; never commit tokens.
5. Single-user only; do not proxy one seat to other humans.

### State machine

`SignedOut` → `SubPool` | `ApiMode` → switch either way → `SignedOut` on logout.

---

## 6. Repository layout

```
grokforge/
├── apps/shell/
├── packages/acp-client/
├── packages/grok-acp/
├── docs/SPEC.md
└── README.md
```

---

## 7. `acp-client` requirements

- Spawn agent with `cwd = workspaceRoot`
- Support: initialize, session/new, session/prompt, dispose/cancel
- Emit normalized events for UI:
  - `text_delta`
  - `tool_request` / `tool_result`
  - `permission_request`
  - `file_edit`
  - `error`
  - `done`
- One agent subprocess per active thread (v1)

---

## 8. `grok-acp` requirements

### Protocol

- ACP agent over stdio (compatible with host)

### Model

- Streaming calls to xAI
- Configurable model id in settings

### Tools (workspace-scoped)

| Tool | Permission default |
|------|--------------------|
| `read_file` | auto-allow |
| `list_dir` / `grep` | auto-allow |
| `apply_patch` / write | **ask** |
| `run_shell` | **ask** |

### Security

- Resolve all paths under workspace root
- Reject `..` and absolute paths outside root
- No tool execution outside approved policy

### Errors

- Structured errors for: auth missing, pool exhausted, API 429, tool failure

---

## 9. Shell UI requirements

- Project open + recent list
- Streaming transcript (markdown)
- Permission modal (Allow once / Allow for session / Deny)
- Diff pane (Accept / Reject)
- Settings: Sign in with Grok, API key, model, clear auth
- Status chip: `Grok · sub-pool` | `Grok · API` | `Signed out`
- Cancel in-flight run

---

## 10. Milestones

| ID | Name | Exit criteria |
|----|------|----------------|
| **M0** | Skeleton | App runs; open folder; empty chat; settings stub |
| **M1** | API chat | Prompt → streamed Grok text via ACP (no tools) |
| **M2** | Read tools | Agent answers repo questions using read/grep |
| **M3** | Write + shell | Patches + shell behind permissions; diffs work |
| **M4** | Sub-pool OAuth | Default sign-in uses subscription pool; API fallback remains |
| **M5** | Hardening | Cancel/restart, limit UX, README first-run |

**v1 ship target:** M3 usable daily; M4 preferred for cost; M5 polish.

---

## 11. Acceptance tests (v1)

1. Open a real repo; ask for entrypoint; agent uses read tools correctly.
2. Request a small fix; review diff; accept; disk matches.
3. Shell command prompts for approval and shows output.
4. API-key mode works end-to-end.
5. Sub-pool sign-in works; status chip shows subscription mode.
6. Simulated/actual pool limit shows recovery path to API key.
7. Attempt to read path outside workspace fails safely.

---

## 12. Non-goals & deferred

- Multi-agent switcher UI (after M5)
- Pixel parity with Claude Code
- Team billing / seat sharing
- Mobile client

---

## 13. Open decisions

| Topic | Proposal |
|-------|----------|
| Framework | **Shipped:** Node host + Vite/React; Tauri optional later |
| Host port | **8787** HTTP + WebSocket |
| Auth MVP | Env / config key + Grok Build `~/.grok/auth.json` |
| Patch format | Unified diff + apply |
| Default model | Configurable; pin a current Grok coding-capable id at ship |

---

## 14. Document history

| Version | Notes |
|---------|--------|
| 0.1 | Unified multi-agent shell design |
| 0.2 | **Grok-first** priority; concrete M0–M5 spec |

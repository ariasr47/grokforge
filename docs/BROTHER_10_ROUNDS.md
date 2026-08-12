# Brother dogfood — 10-round improvement (2026-08-11)

**Goal:** Everything he needs to use Chat daily is discoverable; connectors are honest and testable; smoke is automated.

## Truth table (do not over-promise)

| Need | Status | How brother uses it |
|------|--------|---------------------|
| Sign in (Grok) | **Live** | Settings → Sign in with Grok |
| Chat mode default | **Live** | Stay on Chat |
| Email polish | **Paste workflow** | Paste draft → Chat sample |
| Gmail OAuth / inbox | **Not built** | Planned; paste works today |
| Notion live API | **Optional** | Settings → Connectors → token + Test |
| Notion without token | **Paste** | Export page text → Chat |
| Local files | **Live** | Open folder / Attach |
| PDF native extract | **Gap** | Export to .txt first |
| Calendar write | **Gap** | Draft plan → copy to Google Calendar |
| Slack/Teams | **Paste** | Paste message → rewrite |

## Rounds delivered

| R | Theme | Outcome |
|---|--------|---------|
| 1 | Gap analysis | Brother needs vs Phase 2 MCP; Gmail OAuth blocked without Google app |
| 2 | Onboarding | New step: work tools / Connectors pointer; Chat-first copy |
| 3 | Connectors host | `apps/host/src/connectors.ts` + catalog + store `~/.grokforge/connectors.json` |
| 4 | Connectors API | `GET /api/connectors`, token save, Test endpoints |
| 5 | Connectors UI | Settings → `ConnectorsPanel` (expand, Test, Try in Chat) |
| 6 | Empty states | Gmail / Notion / Slack sample chips |
| 7 | Smoke | `npm run smoke:brother` |
| 8 | Docs | This file + BROTHER_DOGFOOD cross-links |
| 9 | Typecheck | Shell + host green |
| 10 | Manual path | Host smoke; Notion test with real secret when you provide it |

## How you test on your accounts

### Gmail (no OAuth app yet)
1. Open Forge → Chat.  
2. Settings → Connectors → Gmail → **Try in Chat**.  
3. Paste a real thread/bullets → send.  
4. Copy draft back into Gmail.

### Notion (live smoke optional)
1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → New integration → copy secret.  
2. Share a page with the integration.  
3. Settings → Connectors → Notion → paste secret → **Save** → **Test**.  
4. Expect: `Connected as …`. (Page fetch tools still paste-primary until agent tool ships.)

### Local files
1. Folder of `.txt`/`.md` exports.  
2. Chat → Open folder → ask “summarize what you can see”.

## Commands
```bash
npm run start --workspace @grokforge/host   # if host down
npm run smoke:brother
npm run typecheck --workspace @grokforge/shell
```

## Next (not this loop)
- Google OAuth app (Gmail + Drive) with your Cloud project  
- Notion `search`/`retrieve` agent tools using saved token  
- PDF text extract  
- Calendar write / MCP host  

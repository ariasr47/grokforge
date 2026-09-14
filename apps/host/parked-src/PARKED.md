# PARKED — paste-workflow connector catalog (2026-09-13)

**Why:** Settings listed Gmail / Notion / Drive / Slack as Forge connectors. Those were paste prompts plus a Notion token smoke test. Grok’s real connectors live on grok.com. Forge has no vouched API for which accounts are linked. Forge Chat does not use them.

**Restore:** move `connectors.paste-catalog.ts` back to `apps/host/src/connectors.ts` and rewire `GET /api/connectors` plus token/test if we revive paste Test / Try in Chat.

Do not import this folder from host `src/`. Do not delete.

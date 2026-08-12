# Monetization readiness checklist

Product: **ACP-native desktop agent shell** (Grok-first wedge).  
We monetize the **shell, policy, trust, multi-agent UX, support** — not tokens.

## Phase alignment

| Phase | Status | Gate for money |
|-------|--------|----------------|
| 0 Dogfood solid | In progress | Brother Chat week + Code real repos |
| 1 Installable product | Packaging path documented; agent spawn resource-aware | Public/private beta 10–50 |
| 2 MCP/connectors | Not started | Stickiness |
| 3 Enterprise foundation | Audit log + policy.json started | Design partners |
| 4 Monetization | Pricing sketch only | After PMF |

## Shipped toward readiness (this loop)

- [x] Dual-mode Chat \| Code on ACP
- [x] Subscription preferred, API key backup (auth order)
- [x] Agent adapter registry (`grok-acp` ready; others planned)
- [x] User policy file `~/.grokforge/policy.json` (effort cap, agentId, audit flag)
- [x] Local audit JSONL `~/.grokforge/logs/audit.jsonl`
- [x] Automated host contract + dual-mode GATE Q + e2e Playwright
- [x] Diagnostics / session export-import
- [ ] Installer without monorepo (desktop-self-host completion)
- [ ] Signed builds + auto-update
- [ ] License / seat admin (Pro/Team) — not started
- [ ] SSO — not started

## Free Personal forever (growth)

Must remain excellent: local app, Chat+Code, sub pool + key backup, no paywall on basic chat.

## Automated quality bar

```bash
npm run verify          # typecheck + unit tests
npm run gate-q:dual-mode
npm run test:host-contract
npm run e2e             # needs host :8787 + vite :5173
```

## Not now

- Reselling / multi-seat-sharing consumer pool tokens
- Hosted multi-tenant agent running on our GPUs
- Paywalling basic Chat

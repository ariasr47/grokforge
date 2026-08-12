# Product roadmap — ACP desktop agent shell (working titles below)

**Author voice:** Product Management (proposal)  
**Date:** 2026-08-11 (revised same day — ACP-first positioning)  
**Status:** Proposal for operator review — not a committed GATE I sequence  
**Grounding:** Tauri shell + host + ACP + **grok-acp today**; dual-mode Chat|Code in dogfood; desktop-self-host not yet shipped  

---

## 1. Product thesis

### What we are building

An **ACP-native desktop shell** for **coding agents and capable chat** — local-first, lean, highly configurable, enterprise-trustworthy. Any agent that speaks **ACP** can plug in; the UI (Chat mode, Code mode, tools, permissions, diffs, policy) stays the same.

### Why Grok first (wedge, not ceiling)

| Fact | Implication |
|------|-------------|
| Claude has Claude Code / desktop surfaces | Gap closed for Anthropic users |
| OpenAI has Codex / ChatGPT coding surfaces | Gap closed for OpenAI users |
| **Grok has no first-class “Grok Code / Grok Desktop” agent app** | **Market gap we attack first** |
| We have **Grok / SuperGrok pooled subscription** | Preferred auth path for daily use |

So: **Grok is the first ACP backend we ship and dogfood** — because subscription + gap — not because the product is “Grok-only forever.”

### Pillars

| Pillar | Meaning |
|--------|---------|
| **ACP-native** | Host + UI are agent-agnostic; `grok-acp` is the first adapter; Codex/Claude ACP later |
| **Subscription-first auth** | **Pooled sub (OAuth / SuperGrok / provider pool) preferred**; **API key is backup only** |
| **Local-first** | Secrets, workspaces, tools on-device unless user opts in |
| **Dual surface** | **Chat** (everyone) + **Code** (repo agent) — same protocol, different profiles |
| **Lean & fast** | Low chrome, high signal, hard performance budgets |
| **Enterprise-worthy** | Policy, audit, deploy — without SaaS bloat |

**Positioning ladder**

1. **Now:** Grok via ACP — dual-mode shell dogfood  
2. **Next:** Installable product (self-host) others can run  
3. **Then:** Connectors/MCP + team policy  
4. **Then:** Monetize the **shell** (not tokens)  
5. **Later:** Additional ACP agents (Codex, Claude, …) behind the same UI  

**Working brand (open):**  
- Internal/repo: *Grok Code Shell* / *grokforge*  
- Product narrative: **ACP agent desktop** with a **Grok-first go-to-market** until multi-agent is real  
- Modes always: **Chat** | **Code**

---

## 2. Principles (non-negotiable)

1. **Lean before featureful** — every feature must earn retention or revenue.  
2. **Performance is a product feature** — stream, mode switch, cold start budgets.  
3. **Configurable, not complicated** — power in Settings / policy files; simple defaults.  
4. **Trust is the moat** — confine, staged writes, permissions, diagnostics.  
5. **Monetize the shell, not tokens** — no multi-human share of one consumer sub; enterprise pays for client + governance.  
6. **ACP forever** — no second non-agent chat stack; new models/providers = new ACP agents.  
7. **Auth hierarchy** — **pooled subscription preferred**; **API key backup only** (dev, recovery, rate-limit escape).  
8. **Wedge discipline** — ship Grok excellence first; multi-agent when the shell is installable and loved.

---

## 3. Personas & jobs-to-be-done

| Persona | Job | Success metric |
|---------|-----|----------------|
| **P1 Developer** | Local coding agent on preferred model (start: Grok) | Weekly Code sessions; accepted diffs |
| **P2 Knowledge worker** (e.g. brother dogfood) | Everyday Chat: research notes, email, EN↔JA, outlines, clerical — **not** Code mode | Chat WAU; week without helper; real artifacts |
| **P3 Team lead** | One desktop agent policy for the team | Install + policy adoption |
| **P4 Security / IT** | Audit, SSO, no shadow AI | Enterprise pilot conversion |
| **P5 Power admin** | MCP, allowlists, multi-agent later | Config reuse; agent switch when available |

---

## 4. North-star metrics

| Metric | Target (directional) |
|--------|----------------------|
| Time-to-first successful reply (fresh install) | &lt; 3 minutes |
| Mode switch (Chat↔Code) | &lt; 500 ms perceived; zero errors |
| Stream UI jank | Composer stays responsive under long streams |
| Crash / “agent dead” rate | Near-zero with clear reconnect |
| Install success (non-dev machine) | &gt; 90% |
| Paid conversion (when live) | Trial → paid within 14 days |

---

## 5. Phased roadmap

### Phase 0 — **Dogfood solid** (current → ~2–4 weeks)

**Goal:** You and brother trust daily use.

| Theme | Outcomes |
|-------|----------|
| Dual-mode | Chat sessions vs Code folders; effort; no switch crashes |
| Reliability | Agent start/stop, offline transcript, diagnostics |
| Polish | Copy, empty states, settings that matter |
| Quality bar | GATE Q on dual-mode ACs; fix P0/P1 dogfood bugs only |

**Exit:** Brother completes a week of Chat without you present; Code still works for real repos.

**Not in Phase 0:** monetization UI, MCP marketplace, multi-agent.

---

### Phase 1 — **Shipable product** (installable, shareable)

**Goal:** Anyone with Windows (then Mac) can install without cloning the monorepo.

| Theme | Outcomes | Why enterprise/lean |
|-------|----------|---------------------|
| **desktop-self-host** | Host + agent packaged with Tauri; single double-click | #1 blocker for “other people” |
| Signed builds | Code-signed installer; auto-update channel | Trust + IT |
| First-run | Mode pick Chat/Code; sign-in; optional sample | TTFV |
| Stability SLOs | Crash reporting opt-in; health + reconnect | Supportable |
| Config surface v1 | JSON/YAML user config: model, effort default, shell allowlist, theme, mode | Configurable without bloat |

**Monetization readiness:** free **Personal** forever tier (local app + user brings xAI key / SuperGrok). No paid gate yet — growth.

**Exit:** Public or private beta (10–50 users) on installer only.

---

### Phase 2 — **Connectors & capability (lean MCP)**

**Goal:** Chat is “capable desktop Grok”; Code is “capable repo agent” with the same connector framework.

| Theme | Outcomes |
|-------|----------|
| **MCP host** | Registry + enable/disable per mode; sandbox permissions |
| Files / folders | Polished attach, multi-root optional later |
| Policy pack | Per-mode tool allowlists (Chat: safer defaults; Code: full) |
| Secrets | OS keychain; never plain config for tokens |
| Performance | Lazy-load connectors; cap concurrent MCP |

**Configurability:** `~/.grokforge/policy.json` + UI toggles; enterprise can lock via managed config later.

**Exit:** 3–5 first-party connectors + generic MCP; brother uses one non-code connector weekly.

---

### Phase 3 — **Team & enterprise foundation**

**Goal:** Worth piloting at a company without becoming a heavy platform.

| Theme | Outcomes | Lean rule |
|-------|----------|-----------|
| **Org identity** | SSO (OIDC/SAML) for *app* login optional; xAI still user/org key | Don’t re-implement IdP |
| **Audit log** | Local + optional export SIEM (JSON lines) | Append-only, filterable |
| **Policy admin** | Admin-defined allowlists, model allowlist, effort caps, blocked tools | File- or MDM-deployed first |
| **Workspace trust** | Mark trusted folders; prompt outside trust | Same confine model |
| **Deploy** | Silent MSI/MDM; offline docs | Windows first |
| **Data residency** | Default local; cloud sync *optional* and off by default | Local-first |

**Still out:** multi-tenant hosted agent that runs on our servers for free (cost bomb).

**Exit:** 1–2 design-partner companies; security questionnaire packet complete.

---

### Phase 4 — **Monetization**

**Goal:** Sustainable revenue without killing lean culture or violating seat-proxy rules.

#### 4.1 Pricing sketch (proposal)

| Tier | Who | Price sketch | Includes | Does not include |
|------|-----|--------------|----------|------------------|
| **Personal** | Individuals | **$0** | Full local app; Chat+Code; **preferred: provider subscription / pool**; API key as backup | Central admin, SSO, priority support |
| **Pro** | Power users | **$12–20 / user / mo** | Priority updates, effort presets, multi-profile, session backup, early MCP, multi-agent when shipped | SSO |
| **Team** | Small teams | **$25–40 / user / mo** | Shared policy packs, audit export, **app** seat admin, connector allowlist | On-prem control plane |
| **Enterprise** | IT-led | **Custom** | SSO, MDM, air-gap license, DPA, SLA, managed policy, private updates | Running inference on our dime |

**Model costs:** always **customer’s** subscription (preferred) or API key (backup) with **their** provider — we monetize the **shell, policy, connectors, multi-agent UX, and support**.

#### 4.2 Monetization principles

- Never resell or multi-seat-share one consumer pooled subscription across a company.  
- License the **client + control features**, not the tokens.  
- Free Personal stays excellent (distribution).  
- Pro/Team = **config, trust, ops, multi-agent** — not paywalling basic Chat.

#### 4.3 Growth loops

1. Dev shares “open this repo in Grok Code” → installs  
2. Brother-class users stay in Chat → viral word of mouth  
3. Team lead standardizes policy pack → seats  
4. Open-source core optional later (host protocol) / commercial desktop — **decision later**

---

### Phase 5 — **Multi-agent & platform (after shell PMF)**

| Theme | Note |
|-------|------|
| **ACP agent switcher** | Codex ACP, Claude Code ACP, others — same Chat/Code chrome |
| Per-agent auth | Each provider: **sub/pool preferred**, API backup |
| Multi-window / multi-root | Performance-gated |
| Mobile companion | Approve-only / view — not full agent |
| Cloud sync of sessions | Opt-in E2E encrypted |
| Marketplace connectors | Strict review; lean defaults |

**Rule:** Do not block Phase 1–2 on multi-agent. Architecture stays ACP-ready so Phase 5 is additive.

---

## 6. “Enterprise-worthy” checklist (what IT actually asks)

| Area | Lean approach |
|------|----------------|
| Security | Path confine, staged writes, allowlists, keychain, signed builds |
| Compliance | Local-first; audit export; no training on customer data by us |
| Identity | Optional SSO for app; document BYO LLM keys |
| Deployment | MSI + updates; offline mode |
| Support | Diagnostics export (already started); support SLA only on paid |
| Performance | Published budgets (startup, stream, mode switch) |
| Config | Documented schema; MDM-pushable policy file |

---

## 7. Performance & lean operating system

### Budgets (product contracts)

| Surface | Budget |
|---------|--------|
| Cold start to interactive UI | &lt; 3 s on mid laptop |
| Host ready | &lt; 2 s after UI |
| Mode switch | &lt; 500 ms to usable chrome; agent restart may lag with spinner |
| Token stream | UI commit ≤ ~15 fps batch; never block typing |
| Session list | 500 chats without lag (virtualize when needed) |

### Lean process

- Prefer **config flags** over new screens.  
- Prefer **one ACP agent** over many daemons.  
- Kill features that don’t move NSMs in 2 cycles.  
- Dogfood gate: if *you* won’t use it weekly, don’t ship it.

---

## 8. Configurability map (progressive disclosure)

| Level | What | Who |
|-------|------|-----|
| **0 Defaults** | Chat/Code, Auto effort, Voidglass | Everyone |
| **1 Settings UI** | Model, effort, theme, density, allowlist, files panel | Power users |
| **2 Config files** | `config.json`, `policy.json`, model maps for effort | Admins |
| **3 Managed** | MDM / enterprise policy lock | IT |

Never force Level 2 on brother-class users.

---

## 9. Recommended near-term sequence (next 2 quarters)

```text
Q_now     Finish dual-mode dogfood → GATE Q → harden
Q+1       desktop-self-host + signed installer + beta cohort
Q+1/Q+2   MCP host (lean) + policy packs + keychain
Q+2       Pro tier experiment (billing) if retention &gt; threshold
Q+3       Team/Enterprise design partners + SSO/audit
Q+4+      Multi-agent ACP only if PMF clear
```

**Immediate backlog alignment**

1. Close **dual-mode-shell** (GATE Q + ship notes)  
2. **desktop-self-host** (unblocks “other people”)  
3. **mcp-host** (capability without new product category)  
4. Monetization only after Phase 1 beta feedback  

---

## 10. Risks & anti-goals

| Risk | Mitigation |
|------|------------|
| Becoming a mini-IDE | Ruthless non-goals: no LSP/debug v1 |
| Token cost surprises | Clear BYO billing; effort presets with cost hints |
| Dual-mode complexity | One shell, two profiles, shared ACP |
| Enterprise feature bloat | File-based policy before admin consoles |
| Seat proxy abuse | Legal + technical single-user token binding |

**Anti-goals forever (unless strategy changes):**  
scrape grok.com · multi-user share one SuperGrok · cloud agent farm · Electron rewrite · marketplace of random models day one  

---

## 11. Decisions needed from operator (when ready)

1. **Brand:** keep “Grok Code Shell” or rebrand to “Grok Desktop”?  
2. **Open core vs closed desktop:** open-source host/agent later?  
3. **First paid tier:** Pro individual vs Team-first?  
4. **Platform order:** Windows-only until revenue, or Mac in Phase 1?  

---

## 12. Summary

| Question | Answer |
|----------|--------|
| **What is the product?** | ACP-native desktop agent shell (Chat + Code), lean and configurable |
| **Why Grok now?** | Market gap (no Grok Code/desktop agent) + we have pooled Grok subscription |
| **Auth?** | **Subscription / pool preferred**; **API key backup only** |
| **Long term?** | Any ACP agent (Codex, Claude, …) behind the same UI |
| **Money?** | Charge for shell + policy + support; never for reselling tokens |

Make it **usable by others** via **installable self-host** and reliability.  
Make it **enterprise-worthy** via **policy, audit, SSO, signed deploy**.  
Stay **lean and fast** — performance and config depth are product features.

*PM proposal. Promote slices into BACKLOG / GATE I as operator chooses.*

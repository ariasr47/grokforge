---
description: Report current pipeline state from the manifests + backlog (no full bootstrap).
---
Read every `_MANIFEST.md` under `.spire/clusters/tech/contracts/` (live, not `_archive/`), plus `.spire/clusters/tech/context/BACKLOG.md`
§A and the latest "Last GATE I" note. Answer as ONE Status card (`.grok/OPERATOR_REPORTS.md` §3.1):
chip = 🔴 if anything blocks on the operator, 🟠 if anything is failed/bounced, 🟡 if building, ⚪ if
drained/idle; body = the Done/Now/Next table across the live features; one `➡️ Next:` line naming the
natural next gateway (or "queue drained — say go to pick the next feature"). Per-feature rows
(feature · stage · last gateway · open amendments · QA status) go in the technical footer as a compact
table. **Do not act — just report.**

# Context Compressors (standing reference)

Reusable prompts to distill a session into a portable, self-contained artifact. Every
artifact assumes the reader has ONLY `.spire/clusters/tech/context/PROJECT_CONTEXT.md` (the constant ground
truth) plus the inbound contract — never chat history.

Placeholders: `{FEATURE}` = kebab folder name under `.spire/clusters/tech/contracts/`; `{TARGET_ROLE}`;
`{CONTRACT_NAME}` = output filename.

---

## 1. Universal Context Compressor (general)
Use to capture *any* session's work into one handoff/continuation file.

```text
Compress everything decided in THIS session into a single self-contained Markdown artifact.
The reader will have ONLY .spire/clusters/tech/context/PROJECT_CONTEXT.md plus this artifact — no chat history.
Capture: the goal, the decisions made (not the deliberation), any constraints that must not
be violated, the resulting spec/plan, what's done vs open, and concrete next steps. EXCLUDE
reasoning, alternatives explored, and dead-ends. Be decision-dense, prefer bullets.
Write it to .spire/clusters/tech/contracts/{FEATURE}/{CONTRACT_NAME}.md, then print the path and a
5-bullet summary.
```

## 2. Session-Transition Compressor (role → role)
> **Scope narrowed in v1.0.0:** there are no role-to-role contract handoffs any more — the council
> replaced them. Use this for general session transitions (e.g. compressing a long build session for a
> fresh reviewer), not for a gateway handoff.

```text
Compress THIS session into a handoff for the next reader: {TARGET_ROLE}.
Reader has ONLY .spire/clusters/tech/context/PROJECT_CONTEXT.md + this handoff.
Include exactly the sections {TARGET_ROLE} needs to act. Restate any binding constraint they must not
violate — explicitly including the promoted-canon keys this feature touches (the BRIEF's `Invariant
watch` keys) so the next reader inherits them without re-reading the ledger. EXCLUDE your rationale —
ship decisions, not deliberation.
{CONTRACT_NAME} = a session-transition handoff file (e.g. `HANDOFF.md`) under
.spire/clusters/tech/contracts/{FEATURE}/ — write/finalize THAT one file in compressed form; do NOT create a
second handoff file. Print its path + a 5-bullet summary.
```

## 3. Split Context Compressor — RETIRED (v1.0.0)

Its whole job was emitting the three-file execution split at the UX exit. Under the design council the
R4 synthesizer writes `SPEC.md` + `INTERFACE_CONTRACT.md` directly, and there are no execution contracts
to split into. Use `.grok/council/R4-synthesis.md` instead.

## 4. Session-Resume Compressor (continue long work in a fresh tab)
When a single working session gets long/expensive, snapshot it to resume cleanly elsewhere.
Session-level snapshots are **branch-scoped** (`state/<branch-slug>/RESUME.md` — slug = branch name
with every character outside `[A-Za-z0-9._-]` replaced by `-`; detached HEAD ⇒ `detached-<sha7>`); a
feature-scoped resume of one in-flight build goes to `{FEATURE}/RESUME.md`. Both obey the ≤150-line
budget — a resume is boot-class, re-read on every restart.

```text
I'm about to continue this work in a fresh session. Write a resume note to
.spire/clusters/tech/state/<branch-slug>/RESUME.md (or .spire/clusters/tech/contracts/{FEATURE}/RESUME.md for a single
in-flight build) capturing: current objective, what's already done (files changed + decisions
locked), what's in-progress and exactly where it stopped, the next concrete step, and any gotchas
discovered. Date it. Start with **Resume status:** ACTIVE (as of YYYY-MM-DD). ≤150 lines.
Self-contained against PROJECT_CONTEXT.md. No narration of how we got here — just the state needed
to pick up cold. (The next the boot sequence in `ORCHESTRATOR.md` §0 boot will mark it CONSUMED or delete it after re-orientation.)
```

**Consume after pickup (not optional):** once a fresh session has delivered its re-orientation card
from a RESUME, run `node .grok/tools/continuity.mjs mark-consumed <path>` (or `--delete` for RESUME
only). Dated HANDOVER files (ISO date in the name) use
`**Continuity status:** LIVE|SUPERSEDED|CONSUMED` — never delete; supersede when writing a newer handover.

---
### Conventions
- **Repository-backed agent sessions (repo access):** open each role with *"Read .spire/clusters/tech/context/PROJECT_CONTEXT.md
  and .spire/clusters/tech/contracts/{FEATURE}/{X}.md, then act as …"* — reference files, don't paste.
- **Plain web chat:** paste the file contents at the top instead.
- One feature = one folder under `.spire/clusters/tech/contracts/`. Archive/delete when shipped.
- `PROJECT_CONTEXT.md` is the CONSTANT (read by every session); contracts are the VARIABLE.

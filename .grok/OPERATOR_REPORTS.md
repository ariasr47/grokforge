# OPERATOR_REPORTS — the conductor's user-facing voice (standing reference)

> Governs every message the conductor sends the operator in chat: the boot report, every gateway
> status report, role hand-back translations, questions, and FYIs. It changes what the conductor
> SAYS — never what the pipeline WRITES (contracts, manifests, ledgers stay precise + technical).
> Design driver: the operator processes information visually — consistent color coding, tight
> sectioning, bold contrast — and wants exactly the information needed to decide the next move,
> nothing else. ORCHESTRATOR §0 step 9, §5 and §7 route here; they never restate this file.

## 1. Status chips — the color code (fixed vocabulary, never extended)

Exactly five. Always the first line of a report, as `## <chip> <HEADLINE — ≤8 words>`:

| Chip | Meaning | Fires when |
|---|---|---|
| 🔴 **DECISION NEEDED** | waiting on the operator; pipeline paused on this | a blocking choice only the operator can make |
| 🟠 **PROBLEM** | something failed or is blocked | quality-check fail, gate error, bounce, blocked feasibility |
| 🟡 **WORKING** | in progress; nothing needed from the operator | a step closed and the next is already running |
| 🟢 **DONE / SHIPPED** | a milestone closed | ship/archive, or a requested action completed |
| ⚪ **FYI** | informational; safe to skim or ignore | needs no action, closes nothing |

Chip semantics are stable across ALL reports: same meaning, same position, every time. Never invent
a sixth chip; never use these five emoji to mean anything else anywhere in conductor output.

## 2. The card — the universal report shape

Every report is this card. No other shapes.

```
## <chip> <HEADLINE — ≤8 words>
**<project> · <feature>** · <progress, e.g. "stage 2 of 4">

<body: bullets or a 2-column table — one idea per line>

➡️ **Next:** <exactly ONE next action>

---
**Technical detail** *(skip freely)*
<gate ids · file paths · gate-check results · the launch prompt — terse; name files, don't paste them>
```

**Hard caps (binding — a report violating one is wrong, not a style choice):**
- **≤10 lines above the `---` fold** (blank lines don't count).
- **No paragraph over 2 sentences above the fold**; one idea per line (bullets/rows, not prose).
- **Exactly one `➡️ Next:` line.** The conductor picks ONE next action — never a prose list of
  possibilities. Alternatives belong in a Decision card (§3.3) or the footer.
- **At most ONE question per message** (§4 rule 1). A second question waits for the next message.
- **`<details>` is banned** — it does not render in this client. The `---` footer IS the fold, and
  because it is visible it must stay terse: a handful of lines, references not contents; the old
  ORCHESTRATOR §5 block is its ceiling, not its floor. No footer at all when there is nothing worth
  recording.

## 3. Card variants (same skeleton, fixed bodies)

### 3.1 Status card — after every gateway
Body = a three-row table:

```
| | |
|---|---|
| 🟢 Done | <what just locked, in outcome words> |
| 🟡 Now  | <what is running or starting, and where> |
| ⚪ Next | <the step after that> |
```

### 3.2 Re-orientation card — boot, resume, and EVERY background hand-back
Fired at `the boot sequence in `ORCHESTRATOR.md` §0` boot, on a RESUME.md pickup, and as the FIRST report after any
background-lane completion — the conductor cannot know how long the operator was away, so every
background hand-back re-orients. Body = **While you were away:** (max 4 bullets, outcome words)
then one line **Where we are:**.

### 3.3 Decision card — 🔴 only
Body = the question in ONE sentence, then lettered options, each with a one-line consequence:

```
**A** — <option> → <consequence> **(recommended)**
**B** — <option> → <consequence>
```

Answerable by typing a single letter. Always mark the recommendation. 2–4 options, never more.

### 3.4 Problem card — 🟠 only
Body = three labeled lines: **Broke:** <what, plainly> · **Impact:** <what it means for the
product> · **Handling:** <what the conductor is doing about it, or the ONE thing it needs>.

### 3.5 Ship card — 🟢 at ship time
Body = what shipped, in outcome words, + one line "what you can now do". No internal jargon.

## 4. Decision-fatigue rules

1. **One question per message, ever.** If two decisions are pending, ask the blocking one now and
   queue the rest (rule 3).
2. **Default-with-veto.** When the conductor has a clear recommendation AND the choice is
   reversible, it does not ask — it declares and continues: "Proceeding with **A** (<reason>) —
   say `stop` or `B` to override." Blocking 🔴 questions are reserved for irreversible or
   destructive steps (ship/archive, demoting a standing rule, anything spending real money) and
   genuine 50/50 strategic calls.
3. **Batch the non-urgent.** Non-blocking decisions accumulate silently and surface at the next
   gateway close — one card, one question at a time. Never interrupt a running build with a
   non-blocking question. If the session ends first, they land in OPEN_THREADS as usual.

## 5. Plain-word glossary (user-facing voice only)

Above the fold, use the right column. The left column may appear only in the footer and on disk.

| Internal | Say instead |
|---|---|
| GATE I / discovery | picking the next feature |
| GATE C / council / R1–R4 | the design session |
| GATE C R2 conflict / R3 reconcile | a disagreement between the design voices / settling it |
| GATE PLAN / fan-out | plan written — starting the build(s) |
| GATE M / GATE V | quick server-side fix / quick visual fix |
| GATE Q / QA / conformance / lint | quality check / the automated checks |
| GATE S / archive | shipped |
| GATE Z / bounce / amendment | sent back for a fix |
| lanes | build tracks |
| contract / manifest | the written plan / the feature's status sheet |
| canon / promoted invariant | standing rules |

Any remaining necessary term gets a one-phrase gloss on first use ("the interface contract — the
agreed field list both sides build against").

## 6. Golden examples (imitate these; don't re-derive the format)

### 6.1 Status card (a design just locked, build starting in the background)

```
## 🟡 WORKING — nothing needed from you
**acme-shop · checkout-redesign** · stage 2 of 4

| | |
|---|---|
| 🟢 Done | Design locked; automated checks green |
| 🟡 Now  | Both build tracks running in the background |
| ⚪ Next | Quality check, then ship |

➡️ **Next:** I'll report when the builds finish — nothing needed from you.

---
**Technical detail** *(skip freely)*
GATE C closed (council R1–R4 + skeptic; 3 conflicts, 1 escalated) · wrote SPEC.md +
INTERFACE_CONTRACT.md under .spire/clusters/tech/contracts/checkout-redesign/ · contract_lint 0 · GATE PLAN done ·
launch prompts §2/§3 dispatched as background subagents.
```

### 6.2 Decision card (a blocking, irreversible choice)

```
## 🔴 DECISION NEEDED — ship it, or hold?
**acme-shop · checkout-redesign** · quality check passed

Everything passed; shipping archives the feature and updates the standing docs.

**A** — Ship now → feature goes live in the canon; next feature can start **(recommended)**
**B** — Hold for your manual look → I pause here; nothing is archived

➡️ **Next:** reply A or B.

---
**Technical detail** *(skip freely)*
QA_REPORT.md all-PASS · conformance PASS · GATE S is the irreversible step (archive + canon fold-in).
```

### 6.3 Problem card (quality check failed)

```
## 🟠 PROBLEM — quality check failed, fix underway
**acme-shop · checkout-redesign** · stage 3 of 4

**Broke:** the server response is missing two fields the screen needs.
**Impact:** the order page can't show totals until this is fixed.
**Handling:** sent back to the server track with the exact gap; quality check re-runs after.

➡️ **Next:** nothing from you — I'll report the re-check result.

---
**Technical detail** *(skip freely)*
interface_conformance FAIL (2 missing paths) → GATE Z bounce to backend · QA_REPORT.md has the AC rows ·
GATE Q re-runs on the fix.
```

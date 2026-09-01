# Chat daily-use goal — match or beat Claude / ChatGPT for everyday work

**Surface:** Forge **Chat** tab (not Code). Engine is **grok-acp**.  
**Log:** append one broke/fix/re-check/shot line per slice below.  
**Launch:** paste the `/goal` block in §0.

---

## 0. Launch (`/goal`)

```
/goal Chat tab daily-use quality (docs/CHAT_DAILY_GOAL.md). Stay on Chat. grok-acp only — do not switch Chat onto grok agent stdio. Named journeys C1–C10 must PASS on DEV web once and on Desktop twice in a row (png+json+txt each). After that, run Quality pass Q against the competitor rubric. If Q finds an in-scope daily-task blocker, add exactly one named journey (Q1, then Q2, then Q3 max) and recapture; if Q finds only out-of-scope or taste-only gaps, STOP. Pause is first-class. One host :8788. No KEEP series. No second host. No inventing Chat skills/MCP/calendar/voice/image-gen/PPTX engines. Chrome slices need a test that would have failed before the fix. Elect from the first FAIL only.
```

---

## 1. Why this exists

Code already has a production loop (J1–J6). Chat is the product for **everyone else**: email, translation, summaries, outlines, lists, files, a named home. Claude.ai and ChatGPT set the daily bar. Forge Chat must complete those jobs in Voidglass without sending the user to the TUI or the Code tab.

**Exceed, don’t clone:** named home + pack, Open-beside-the-bubble artifacts, local export, honest PDF, visible Effort — if they work, they beat a generic web chat. If they don’t, they are worse than Claude/ChatGPT.

---

## 2. Goal kind

`code-change` with live Chat dogfood. Stay in **Chat**. Do not “fix Chat” by routing it through Code’s vendor agent (`chat-on-vendor` is parked).

---

## 3. Competitor bar (observable — not vibes)

A row is the daily job. **Forge must** is the Chat observable. **Out** is what we refuse even if Claude/ChatGPT have it.

| # | Daily job (Claude / ChatGPT) | Forge must (observable) | Out |
|---|------------------------------|-------------------------|-----|
| 1 | New conversation, obvious empty | Chat empty state “Chat with Grok”; sample chip fills composer; **New chat** exists | Code empty / “Code continuum” |
| 2 | Type, stream, done, next turn | Streamed Grok text; **Answered**; **Your turn**; composer enabled | Thought shown as the answer |
| 3 | Follow-up remembers the thread | Second send cites first-turn fact; not a cold start | Invented memory / glossary product |
| 4 | Rewrite email / Slack | Paste bullets → professional short mail in the answer; **Copy** copies markdown | Auto-send to Gmail |
| 5 | Translate (EN↔JA) | Full translation + glossary; Effort **Expert** is selectable | Bundled translation engine |
| 6 | Summarize a report | Structured findings (summary / risks / questions) from pasted text | Web browse / computer use |
| 7 | Attach context | Attach or pack pin; You card shows mention/name, not the dump; answer uses the body | Fake `@name` with no bytes |
| 8 | Named project | Rename home; title survives reload; pack members still listed | Cloud sync / Custom GPTs |
| 9 | Long answer isn’t a wall | **Open** on long/grok-ui; bubble compact; panel has the body | HTML sandbox / PDF viewer |
| 10 | Stop / retry / copy | Stop → “Stopped by you”; Retry resends user text; Copy succeeds | Fork/rewind product (later) |
| 11 | Structured choices | grok-ui **choices/carousel** or markdown table; click fills composer, does **not** auto-send | Arbitrary HTML |
| 12 | Take work away | **Export** `.md` contains You + Grok turns | `.pptx` / `.docx` binary export |
| 13 | Fail honestly | Engine-stopped copy; conversation saved; **Try again** when allowed | Fake “still connected” |
| 14 | PDF | Attach PDF → native text in play **or** honest extract-failed (no mojibake) | Invented PDF body |
| 15 | Chat is not Code | No Plan / File changes / Verify / Git review / Skills catalog as Chat chrome | Moving Chat onto `grok agent` |

Quality pass **Q** walks this table against the last green shots. A miss on 1–15 that is **in-scope** is a blocker (add one journey). A miss that is **Out** is recorded, not built.

---

## 4. Named journeys (the efficient set)

Each journey: one Chat send-path on **DEV web** (`:5174`) and **Desktop** (Forge Dev). Artifacts: `{SCRATCH}/web-C{n}.{png,json,txt}` and `{SCRATCH}/desktop-run{1,2}-C{n}.{png,json,txt}`. `PASS` whose JSON contradicts the named observable is **FAIL**. Console containing `Maximum update depth exceeded` is **FAIL**.

| ID | Job | Prompt / action (fixed) | Named observables |
|----|-----|-------------------------|-------------------|
| **C1 Open** | Empty → first send | Click Chat. Click sample *or* send: `Reply with exactly CHAT-C1-OK and stop.` | Mode Chat; empty copy is Chat not Code; stream; **CHAT-C1-OK** in assistant; **Your turn**; composer enabled |
| **C2 Follow-up** | Thread memory | C1 then: `What exact token did I ask you to reply with? Answer with that token only.` | Second You card; answer contains `CHAT-C1-OK`; not a new-session amnesia |
| **C3 Email** | Rewrite | `Turn these bullets into a short professional email (no extra commentary): need Q3 numbers by Friday; keep the tone warm.` | Answer is an email (greeting/body/sign-off or equivalent); **Copy** control present; Thought not the email |
| **C4 Translate** | EN↔JA + glossary | Set Effort **Expert**. Send a 4–6 sentence English paragraph + `Translate to Japanese, business tone, glossary of proper nouns at the end.` | Japanese body; a glossary; Effort Expert still shown; Thought collapsed or not the translation |
| **C5 Attach** | File in the turn | Attach or pin a small `.md` (e.g. `docs/dogfood/KEEP.md`) and ask to quote its first heading. | You shows `@`/`KEEP.md` **not** `[Attached file contents…]`; answer quotes the real heading |
| **C6 Home** | Named home + pack | Rename home to `C6-HOME`. Pin one file if pack UI is there. Reload. | Title `C6-HOME` after reload; Chat still Chat; pack member still listed **or** honest empty pack (no invented files) |
| **C7 Artifact** | Long answer Open | Prompt that yields long markdown **or** grok-ui (`Compare Fast vs Expert in a grok-ui compare block plus a 200-word note.`). Click **Open**. | **Open** exists; `.assistant-answer--compact` or hidden bubble; artifact panel body non-empty |
| **C8 Stop/Retry/Copy** | Controls | Send a long prompt; **Stop** if still streaming. Then **Copy** on the last Grok bubble. If Retry exists on the last You, click it. | Stopped-by-you **or** completed answer; Copy → Copied/no error; Retry resends if offered |
| **C9 Structured** | Choices don’t auto-send | `Offer two tones for a Slack reply as grok-ui choices (recommended on one). Do not send anything.` Click a choice. | grok-ui choices **or** a markdown table; click fills composer; **no** auto-send; Send still the user’s |
| **C10 Export** | Take it away | After C3 or C1, **Export**. | File/download exists; contents include a You turn and a Grok turn from this chat |

**C11 PDF** (only if C1–C10 are green and Q flags PDF as a daily blocker): attach a small text-layer PDF; extract text **or** honest fail. Do not invent a viewer.

Do **not** add journeys for: voice, image generation, Gmail OAuth, calendar, PPTX file, Custom GPTs, computer use, Code Plan/File changes, KEEP overwrite, `/always-approve`.

---

## 5. Acceptance criteria

1. **C1–C5** — Open, follow-up, email, translate, attach: each has png+json+txt on DEV web and two desktop runs; JSON matches the named observables.
2. **C6–C10** — Home/pack, artifact Open, stop/retry/copy, structured choices, export: same artifacts and observables.
3. **Chat is Chat** — No journey paints Code continuum, Plan dock, File changes, Verify, Git review, or a Skills catalog as Chat chrome. Policy copy in Chat stays brother-safe (no ACP jargon in empty/error).
4. **Quality pass Q** — After two consecutive desktop greens on the current journey set, walk §3 against the last green shots (and a live Chat session). Write `{SCRATCH}/quality-Q.md`: each row Pass / Blocker / Out. Blocker ⇒ add **one** journey (Q1 then Q2 then Q3 max) with observables, unit test if chrome, recapture. Out or taste-only ⇒ list and **STOP**.
5. **Stop bar** — Current set (C1–C10 plus any Qn) green **twice in a row on desktop**, **and** Q has no in-scope blocker, **or** the operator says pause. No KEEP series. No overlapping schedulers. One driver owns `:8788` (wrapper death ≠ down if health 200). Chrome slices have a test that would have failed before the fix. Do not invent Chat skills/MCP/cwd/plan engines. Do not move Chat onto `grok agent stdio`.

---

## 6. Verification plan

1. **gating (units):** In-repo tests on **shipped** Chat functions: empty-state Chat samples; session title **New chat** on `chat:` partitions; pack pin/You mention hides dump; artifact compact when Open; export contains turns; PDF extract-fail is honest; grok-ui choices fill composer. Copy to `{SCRATCH}/unit-chat.log`. Fail if tests don’t call the shipped unit.
2. **gating (host):** One host. `http://127.0.0.1:8788/api/health` 200. `{SCRATCH}/host-health.txt`. Never start a second `:8788`.
3. **gating (DEV web Chat):** Mode **Chat**. Run C1–C10 (then any Qn). `{SCRATCH}/web-C{n}.{png,json,txt}`. PASS whose JSON contradicts the named observable is FAIL. Max-update-depth in console is FAIL.
4. **gating (Desktop Chat):** Forge Dev. Chat tab. C1–C10 (then Qn) **twice**. `{SCRATCH}/desktop-run{1,2}-C{n}.*`. Honest `{SCRATCH}/desktop-launch.txt` if the window cannot be driven (do not fabricate pixels).
5. **gating (Q):** `{SCRATCH}/quality-Q.md` against §3 using the last green shots + one live Chat session. Blocker ⇒ one new journey only.
6. **evidence:** One broke/fix/re-check/shot line per slice in **this file**. After `packages/acp-client` change: rebuild dist, restart the one host. Visual budget: one shot per journey per slice.

---

## 7. Non-goals

- Code J1–J6, Plan, File changes, Verify, Git review, vendor Skills catalog.
- `chat-on-vendor` (parked). grok-acp stays Chat’s engine.
- Voice, image gen, Gmail/calendar OAuth, PPTX/DOCX binaries, Custom GPTs, computer use, Forge-built MCP/skills engines.
- KEEP-TEN… overwrite series; overlapping 5-minute schedulers; a second `:8788`.
- Commit/push/release unless asked.
- Unbounded chrome diary. At most **three** Q-added journeys.

---

## 8. Assumed scope

DEV web `:5174` + one DEV host `:8788` + `desktop:dev` (Forge Dev). Chat partition `chat:`. Named home + pack, attach, PDF extract in grok-acp, grok-ui, Artifact panel, Export, Effort, Copy/Retry/Stop as shipped. Playwright dogfood driver may grow Chat flags (`FORGE_CHAT=1`) rather than invent a second harness. `docs/BROTHER_DOGFOOD.md` jobs are the persona, not extra journeys.

---

## 9. Implementation approach

- Prefer shipped units (empty copy, `defaultSessionTitle`, pack mention vs dump, `elevateArtifact`, export assembler, PDF fail copy, grok-ui parse). Tests call those functions.
- Playwright only to capture C* artifacts and Q screenshots.
- Elect the next slice from the **first FAIL** only.
- Quality pass Q is a review against §3, not a new KEEP series. It may add one journey, then recapture that journey, then Q again, until Q is clean or Q3 is spent.

---

## 10. Task checklist

- [x] One host: health 200; `{SCRATCH}/host-health.txt`. Chat tab, not Code.
- [x] Units for C1–C10 observables; `{SCRATCH}/unit-chat.log`.
- [x] Web C1–C10; elect from first FAIL.
- [x] Desktop C1–C10 twice; elect from first FAIL.
- [x] Quality pass Q; `{SCRATCH}/quality-Q.md`. Add Q1/Q2/Q3 only for in-scope blockers.
- [x] Log a line per slice in this file. Stop on two consecutive desktop greens **and** Q clean, or pause.

---

## 11. Risks

- Chat live turns need grok-acp + auth. If the environment cannot stream, capture honest failure; do not fake assistant tokens.
- Desktop CDP origin is `localhost:5174` (not `127.0.0.1`) so Tauri IPC stays allowed.
- Pause overrides “green twice.”
- Occupied `:8788`: attach or kill the owned listener; never start a second host.
- Q taste comments (“make it prettier”) are not blockers unless they hide a daily job in §3.

---

## 12. Slice log

- **C1 Open / web / broke:** first send crashed the Chat tree — Vite still served a stale `RunSurface` that called deleted `forgeFx` (`react-uncaught: forgeFx is not defined`). Shot black, JSON empty, `emptyBeforeSend` was `Chat with Grok`. Host did admit the prompt (`mode:chat`, len 39) and `agent done`.
- **C1 Open / web / fix:** disk `RunSurface.tsx` already had no `forgeFx`; busted Vite by touching the file (served `forgeFx` 2→0). Added unit: `RunSurface` source must not mention `forgeFx` (would have failed before the Code-goal strip).
- **C1 Open / web / re-check:** `{SCRATCH}/web-C1.{png,json,txt}` PASS — mode Chat, empty `Chat with Grok`, token `CHAT-C1-OK`, Answered, Your turn, composer enabled, no max-depth. Host `:8788` unchanged.
- **C2 Follow-up / web:** PASS — second You card; answer is `CHAT-C1-OK` (thread memory). `{SCRATCH}/web-C2.*`
- **C3 Email / web / broke:** live RunSurface answer had no Copy (MessageList bubbles did). Email body was fine.
- **C3 Email / web / fix:** Copy on `.assistant-answer-actions` via `writeClipboard(cleanVendorAnswer)`. Unit: RunSurface Chat answer offers Copy (would have failed before).
- **C3 Email / web / re-check:** `{SCRATCH}/web-C3.*` PASS — Subject/Hi/Thanks email + `copyPresent`.
- **C4 Translate / web:** PASS — Japanese + glossary + Effort Expert. `{SCRATCH}/web-C4.*`
- **C5 Attach / web / broke:** `@KEEP.md` in Chat sandbox ENOENT (no dump, no heading).
- **C5 Attach / web / fix:** Attach path uses `MENTION_ATTACH_MARKER` + `@filename`; driver `FORGE_ATTACH_FILE` after fill. Unit: dump hidden, `@KEEP.md` shown.
- **C5 Attach / web / re-check:** PASS — You `@KEEP.md`; answer `KEEP-FORTYEIGHT`. `{SCRATCH}/web-C5.*`
- **C6 Home / web / broke:** reload painted conversations-not-found while `C6-HOME` listed (empty named home ≠ stored history).
- **C6 Home / web / fix:** `hasAnyStoredHistory` treats `committedName` as history. Unit: named empty Chat → Chat with Grok, not not-found.
- **C6 Home / web / re-check:** PASS — `C6-HOME` + Chat with Grok. `{SCRATCH}/web-C6.*` Desktop C6 twice PASS.
- **C7 Artifact / web:** PASS — Open + panel body + compact. `{SCRATCH}/web-C7.*`
- **C8 Stop / web / broke:** cancelled notice had no Retry; Copy missing with no Grok bubble.
- **C8 Stop / web / fix:** Retry on cancelled `RunTerminalNotice`. Unit would have failed before.
- **C8 Stop / web / re-check:** PASS — Stopped by you + Retry. `{SCRATCH}/web-C8.*`
- **C9 Structured / web:** PASS — choices fill composer, no auto-send. `{SCRATCH}/web-C9.*`
- **C10 Export / web / broke:** `.md` had You only (live RunSurface answer not in `messages`).
- **C10 Export / web / fix:** `mergeLiveRunsForExport`. Unit would have failed before.
- **C10 Export / web / re-check:** PASS — `## You` + `## Grok`. `{SCRATCH}/web-C10-export.md`
- **Desktop run1+run2 C1–C10:** ALL PASS (CDP `:9222`, Chat). First captures had banner `:8810` because `host:dev` held `:8788` and Tauri stepped. **Host resolve:** killed extra `:8810` + `host:dev`, restarted only `desktop:dev` so `ensure_host` owns `:8788`. Recapture desktop-run1+run2 C1–C10+Q1 ALL PASS; every JSON banner `host :8788`; `:8810` down. `{SCRATCH}/host-health.txt` pid 83976.
- **Q:** `{SCRATCH}/quality-Q.md`. Q1 reload-keeps-transcript. First desktop Q1 leaked Plan restore on Chat.
- **Q1/Q2 / fix:** `PlanSection` only when `productMode !== "chat"`. Unit: Chat RunSurface has no `.plan-section`.
- **Q1 recapture:** web + desktop-run1 + desktop-run2 PASS — transcript kept, `planSection: null`.
- **STOP:** two consecutive desktop greens on C1–C10+Q1; Q has no in-scope blocker. Taste only: pack-checking chrome, untitled homes, Policy: Review.

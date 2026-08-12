# Brother dogfood — Chat-first knowledge worker

**Who:** Non-developer daily user (your brother).  
**Mode:** **Chat only** (leave **Code** alone unless he asks).  
**Goal:** A week of real work without you present → feedback on product ideas, friction, “I wish it could…”.

Product framing for him: *a desktop AI assistant for writing, research, and files* — not “a coding tool.”

---

## 1. What he should try (map to his jobs)

| His job | Can he do it **today**? | How to try it | What to write down if it fails |
|---------|-------------------------|---------------|--------------------------------|
| Analyze **market research** (sector reports) | **Partial** | Prefer **text/MD** exports in a folder, or paste chunks into chat. PDF binary not fully read yet. | “I had a PDF and…” |
| Large **PDF** corpus | **Limited** | Prefer **Attach** for `.txt`/`.md` exports, or paste. PDF shows a clear “export to text” message (no mojibake). Native PDF extract still not built. | Needs native PDF |
| Export work product | **Yes** | Composer **Export** (or Ctrl+K → Export this chat as Markdown) | — |
| **Summarize / write emails & chats** | **Yes** | Paste draft or bullet notes → “make this professional / shorter / warmer” | Tone quality |
| **EN ↔ JA translation** (long) | **Yes** | Paste source; ask for full translation + glossary of terms. Use **Expert** effort for long jobs. Split very long docs into sections. | Quality / consistency |
| Create **presentations** | **Outline only** | Ask for slide outline + speaker notes (Markdown). He pastes into PowerPoint/Google Slides. No `.pptx` file export yet. | “Wanted a real PPT file” |
| Organize desktop / **Windows MCP** | **Not yet** | Do not promise. Note as future. Manual: he describes folders, agent can draft a plan. | MCP request |
| Clerical / recipes / task lists | **Yes** | Chat as notepad: lists, steps, checklists. Not a calendar app. | Wants reminders |
| Reminders / **calendar** | **Not built-in** | Agent can draft a schedule; no OS calendar sync. | Calendar integration |
| **Projects + context** | **Yes (sessions)** | New chat per project; rename session; optional **Open folder** with project files. Export sessions from Settings if he wants backup. | Session confusion |
| **Add context** (files) | **Yes** | Chat → optional **Open folder** (sidebar Local files). Or paste text. Drag-drop file names into composer where supported. | File UX |

---

## 2. Install / first 10 minutes (you set him up)

1. Install / run the desktop app (or your shared build).  
2. Leave him on **Chat** (top mode switch).  
3. **Sign in with Grok** (subscription preferred) — or API key only if needed.  
4. Skip Code / Open project unless he wants tools on a documents folder.  
5. Optional: create a folder like `Documents\GrokWork` with market notes as `.txt` / `.md` and use **Open folder** in Chat for tools.  
6. Show: type → **Enter** to send; **New chat** for a new topic; **Settings** only if sign-in breaks.  
7. **Connectors (Settings):** Gmail/Notion/etc. are listed honestly — most are **paste workflows** today; Notion can take an optional integration secret + Test. See `docs/BROTHER_10_ROUNDS.md`.

Do **not** teach: terminals, monorepo, Code mode, allowlists, GATE Q.  
Do **not** promise “Connect Gmail” login until Google OAuth ships.

---

## 3. Sample prompts he can copy

**Research / sector notes**
> Here is an excerpt from a [sector] market report. Summarize key players, growth drivers, risks, and 5 questions for a client meeting.  
> [paste text]

**Long translation**
> Translate the following to Japanese. Keep a glossary of company names and technical terms at the end. Formal business tone.  
> [paste]

**Email**
> Turn these bullets into a short professional email to a client. Friendly but not casual.  
> [bullets]

**Presentation**
> Create a 8-slide outline for a presentation on [topic] for non-experts. Each slide: title, 3 bullets, speaker note.

**Tasks / recipes / clerical**
> Make a checklist for preparing [event].  
> Convert this messy note into a clean recipe with ingredients and steps.

**Projects / context**
> This chat is my “Japan market Q3” project. Remember we care about competitive positioning vs X. Summarize what we know so far when I ask “status”.

---

## 4. Feedback form (send him this)

After a few days, collect:

1. **What did you use it for most?**  
2. **What felt magic?**  
3. **What felt broken or slow?**  
4. **Did Chat vs Settings confuse you?**  
5. **Where did you need a file (PDF/PPT) and couldn’t?**  
6. **Would you use this weekly instead of ChatGPT/web?** Why / why not?  
7. **Top 3 features you’d pay for** (if anything).

Optional: Settings → **Export diagnostics** / **Export sessions** if something breaks (he can send you the file).

---

## 5. Product implications (for us)

| Priority for brother persona (P2) | Status | Next build when we prioritize him |
|-----------------------------------|--------|-----------------------------------|
| Bulletproof Chat + sign-in | In dogfood | P0 bugs only during his week |
| PDF read / multi-file research packs | Gap | PDF extract tool or “import PDF as text” |
| Long EN↔JA quality | Model + effort | Heavy effort default option for Chat; glossary memory |
| Presentations | Outline only | `.pptx` export skill later |
| Windows MCP / desktop organize | Gap | After self-host + MCP host phase |
| Calendar / reminders | Gap | Integrations or local task file — product decision |
| Projects + context | Sessions exist | Named projects, pin context pack UI |

Roadmap exit criterion already matches this: *“Brother completes a week of Chat without you present.”*

---

## 6. Script you can send him (plain language)

> This is a desktop app where you chat with Grok. Stay on **Chat**.  
> Sign in once under Settings if asked.  
> Type normal questions — email drafts, translations, summaries, plans.  
> For big documents: paste text, or put text files in a folder and use **Open folder** so it can read them.  
> PDFs: convert to text first for now.  
> Start a **new chat** when you change topic (Japan report vs recipes).  
> If something fails, screenshot it or use Export diagnostics and send it to me.  
> Ignore **Code** mode — that’s for programming.

---

## 7. Your success criteria for this dogfood

- He opens the app **without you** at least 4 days in one week.  
- He completes ≥1 real work artifact (email, translation, summary, slide outline).  
- You get a short feedback list (section 4) — even if messy.  
- No requirement that he uses Code, MCP, or developer tools.

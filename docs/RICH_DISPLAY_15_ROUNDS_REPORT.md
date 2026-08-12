# Report: 15 rounds — rich chat display (Claude/Codex-class response UI)

**Date:** 2026-08-11  
**Scope:** Chat bubble presentation only — markdown, allowlisted rich components, streaming, tool chrome, parse performance.  
**Not in scope:** Full HTML sandbox, Artifacts side panel (next horizon).

---

## Baseline → After (measured)

| Metric | Baseline | After | Δ |
|--------|----------|-------|---|
| `markdown.tsx` LOC | 292 | 439 | **+50%** structure |
| Rich UI stack LOC (`richUi`+`RichBlocks`) | 556 | 805 | **+45%** |
| CSS rich/md display selectors (approx) | ~47 | ~80 | **+70%** |
| Allowlisted component types | 8 | **13** | +5 |
| Shell unit tests | 29 pass | **36 pass** | +7 |
| Shell typecheck | clean | clean | — |
| Parse cache | none | LRU 80 | new |

---

## Round-by-round log

| # | Theme | Change | Win |
|---|--------|--------|-----|
| 1 | Tables | GFM pipe tables in markdown | Product-grade comparisons without grok-ui |
| 2 | Task lists | `- [ ]` / `- [x]` rendering | Checklists in plain MD |
| 3 | Strikethrough | `~~text~~` | Editorial polish |
| 4 | Code highlight | Lightweight tokenizer (kw/str/num/cmt) | Visual structure without deps |
| 5 | Line numbers | Code blocks show LN + line count | Scan long snippets faster |
| 6 | Link safety | Only http(s)/mailto get href | XSS hygiene |
| 7 | Progressive rich | `parseRichDocumentProgressive` | Partial grok-ui while streaming |
| 8 | Stream hybrid | Structured MD/rich renders *during* stream | No wait for settle for tables/cards |
| 9 | Progress block | `progress` type 0–100 | Visual completion cues |
| 10 | Timeline | `timeline` type | Narrative / plan phases |
| 11 | Quote + checklist + file | 3 new blocks | Docs & research aesthetics |
| 12 | Parse cache | LRU + hashKey for MD blocks | Fewer re-parses on long sessions |
| 13 | Tool chrome | Live spinner on pending tools | “Activity is visual” (Codex/CC pattern) |
| 14 | Bubble typography | Assistant MD size/line-height/H hierarchy | Prose readability |
| 15 | Agent + docs | Prompt lists all 13 types; tests + this report | Measurable adoption path |

---

## Qualitative wins (vs Claude Code / Codex patterns)

| Industry pattern | Before | After |
|------------------|--------|-------|
| Markdown-first beauty | Basic | Tables, tasks, strike, better code |
| Allowlisted structured UI | 8 types | **13 types** + progressive parse |
| Streaming feels alive | Often plain dump | Hybrid structured live render |
| Tool activity design | Static status | Spinner + live row |
| Parse cost on re-render | Full re-parse every time | Cached by content hash |

---

## How to verify (manual, ~2 min)

1. Refresh desktop app; **new Chat** (new agent system prompt).  
2. Ask: *“Compare Auto/Fast/Expert/Heavy as a table and as a carousel with Choose this.”*  
3. Expect: markdown table **and/or** `grok-ui` carousel; click choice → composer fills.  
4. Long code paste → line numbers + keyword colors.  
5. During stream of a long answer with ` ```grok-ui ` → “Building rich layout…” then cards.

---

## Remaining gaps (honest)

| Gap | Why it still matters |
|-----|----------------------|
| Side **Artifacts** panel | Big docs/PPT still crowd the bubble |
| Full Shiki/Prism themes | Our highlighter is intentionally light |
| Mermaid diagrams | Not shipped |
| Model compliance | Model may still answer in plain MD unless prompted |

---

## Conclusion

**Measured win:** +7 automated tests, +5 component types, ~50–70% more display surface code/CSS, parse caching, and live structured streaming — all on the “beautiful responses like Claude/Codex” axis without opening raw HTML.

**Product verdict:** Chat is now a **structured-content renderer** (Markdown + allowlisted components), not a plain text log. Next leap on this same track: **Artifacts side panel** + optional Mermaid.

# 10-round improvement loop (KW + Dev)

Executed 2026-08-11 after persona deep dive.

| Round | Theme | Delivered |
|-------|--------|-----------|
| 1 | KW attach | `contextAttach.ts` + composer Attach + real drag-drop text ingest |
| 2 | KW export | `exportChat.ts` + Export button + palette “Export this chat as Markdown” |
| 3 | KW honesty | PDF/binary `read_file` messages; attach PDF guidance |
| 4 | KW UX copy | Onboarding, empty states, permissions, sandbox wording, boot brand |
| 5 | Continuity | Prompt `history[]` UI→host→acp-client→grok-acp seed |
| 6 | Dev @file | `expandMentions.ts` on send with workspaceRead |
| 7 | Dev scale | maxTurns 20, index 800, grep 1200, allowlist pwsh/rg/cargo |
| 8 | Effort/KW | Effort chip titles for long translate / heavy reports |
| 9 | Tests | Unit tests attach/export/mentions; host-contract still green |
| 10 | Dogfood | Live Chat prompts + Code workspace prompt via host API |

## Verify
```bash
npm run verify
npm run test:host-contract
npm run e2e   # optional UI
```

## Next loop candidates
PDF extract library · project pins · multi-hunk diffs · structured test panel · desktop-self-host resource bundle

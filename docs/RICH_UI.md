# Rich chat UI (allowlisted components)

Chat bubbles are **not** a full HTML browser. Agents emit structured JSON in a fenced block; the shell renders **safe React components** only.

## Agent format

````markdown
Here is a short intro in normal markdown.

```grok-ui
{
  "version": 1,
  "blocks": [
    {
      "type": "carousel",
      "title": "Effort levels",
      "items": [
        { "title": "Fast", "body": "Snappy, shallow", "badge": "Speed" },
        { "title": "Expert", "body": "Deep reasoning", "badge": "Quality" }
      ]
    },
    {
      "type": "choices",
      "prompt": "Which do you want?",
      "options": [
        { "label": "Fast", "description": "Quick answers" },
        { "label": "Expert", "description": "Longer think" }
      ]
    }
  ]
}
```
````

Language tags accepted: `grok-ui`, `grokui`, `ui`, `rich-ui`.

## Components

| type | Purpose |
|------|---------|
| `callout` | Highlight note (`tone`: info/success/warn/danger/neutral) |
| `carousel` | Swipeable decision/info cards + “Choose this” |
| `choices` | Grid of clickable options |
| `steps` | Numbered procedure |
| `kv` | Key/value rows |
| `compare` | Simple table |
| `metrics` | Big numbers |
| `tabs` | Labeled panels |

## Security

- No arbitrary HTML/CSS/JS
- Unknown `type` dropped
- String lengths and list sizes capped in `richUi.ts`
- Choice click only fills the **composer** (does not auto-send)

## Files

- `apps/shell/src/richUi.ts` — parse + sanitize  
- `apps/shell/src/RichBlocks.tsx` — render  
- `apps/shell/src/markdown.tsx` — fence integration  
- Agent prompts: `packages/grok-acp/src/xai.ts` (`CHAT_SYSTEM_PROMPT`)

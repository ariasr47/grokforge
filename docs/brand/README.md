# FORGE brand & wireframes

## Decision (approved)

| Field | Value |
|-------|--------|
| **Primary theme** | **C — Aeon Continuum** |
| **Product name** | **Forge** |
| **Flagship agent** | Grok (xAI) — presence in UI, not product title |
| **Approved** | 2026-08-11 (`I want C`) |

Implemented in `apps/shell` (tokens, chrome, thought surfaces, living mark, FORGE copy). Layout remains dual-pane shell (usable for dogfood); visual language is Aeon (plasma/mind, constellation field, pill composer, breathe/pulse motion).

## Generate assets in Grok Imagine

Full brand brief + **one file per asset** (desktop icon, UI mark, favicon, boot, mood, installer, OG):

**→ [`docs/brand/imagine/`](./imagine/)** — start with `00-BRAND-BRIEF.md`, then asset files (`01`…`08`).

| Prompt | Concept |
|--------|---------|
| `01-desktop-icon.md` | Teardrop / nucleus (current install) |
| `08-desktop-icon-alien-forge.md` | Alien forge (dwarven craft → Aeon) |

Drop finished PNG masters in `docs/brand/source/`.

## Wireframes (archive)

Open in a browser:

`docs/brand/forge-wireframes.html`

```bash
start docs/brand/forge-wireframes.html
```

| ID | Name | Intent |
|----|------|--------|
| **A** | Voidglass Forge | Previous dark glass DNA |
| **B** | Foundry Graphite | Copper/charcoal instrument |
| **C** | Aeon Continuum | **Shipped primary** — light-fields, orbs, motion |

Mood art:

- `foundry-mood.jpg` — B  
- `aeon-mood.jpg` — C  

## Product naming

- **Product:** Forge  
- **Flagship agent:** Grok (xAI)  
- **Avoid:** shipping as “Grok Code Shell” identity  

## Shipped system (post C approval)

| Layer | Implementation |
|-------|----------------|
| **Typography** | Geist + Geist Mono scale (`--text-xs`…`--text-xl`, tracking labels) |
| **Field** | Canvas GPU layer (`FieldLayer.tsx`) — nebula + twinkling stars |
| **Mark (UI)** | Vector SVG component `BrandMark.tsx` + `public/brand-mark.svg` (not a photo) |
| **Mark (desktop)** | High-res Imagine master → HQ PNG/ICO in `src-tauri/icons/` |

## Icon craft notes

| Surface | Tool | Why |
|---------|------|-----|
| **Topbar / boot mark** | **Hand-crafted SVG** (code) | Must stay crisp at 16–32px; AI photos go muddy |
| **Desktop / taskbar / installer** | **Imagine** for master art + careful multi-size export | Hero fidelity at 256–512; silhouette must still read at 16px |
| **Marketing / mood** | Imagine | Full aesthetic freedom |

Avoid: using a downscaled photoreal blob as the in-app logo.
| **Motion** | Full / Calm pref + `prefers-reduced-motion` |
| **Theme** | `aeon` (default) \| `light` (legacy `voidglass` migrates) |
| **Icons** | `apps/shell/src-tauri/icons/*` + `apps/shell/public/forge-icon.png` |

## Follow-ups

- Rebuild desktop installer to pick up `productName: Forge` + new `.ico`  
- Host log strings can stay agent-focused (“Grok”) without product stamp  


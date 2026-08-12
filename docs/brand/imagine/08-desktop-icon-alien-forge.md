# Imagine prompt — Desktop icon / mark: Alien Forge (Aeon Continuum)

**Use with:** [`00-BRAND-BRIEF.md`](./00-BRAND-BRIEF.md) (paste the brief first, or use the brand capsule at the bottom of that file).  
**Relationship:** Alternate mark concept to the teardrop nucleus in [`01-desktop-icon.md`](./01-desktop-icon.md). Same product and theme; different silhouette language.  
**Aspect ratio:** **1:1 square**  
**Output:** highest resolution — **download as PNG** (not JPEG)  
**Background:** **transparent** (alpha) for Windows taskbar  
**Save as:** `docs/brand/source/01-desktop-icon-alien-forge.png`  
**Installs to:** same as desktop icon — `apps/shell/src-tauri/icons/` + `apps/shell/public/forge-icon.png` (replaces teardrop if approved)

> **Read the brand brief first.** This file only defines the *silhouette concept*. Colors, product naming (Forge vs Grok), do/don’t, and PNG rules are owned by `00-BRAND-BRIEF.md`.

---

## Brand context (from brief — required)

| Field | Value |
|--------|--------|
| **Product** | **Forge** — desktop AI agent shell (Chat + Code) |
| **Theme** | **Aeon Continuum** (Theme C) — light-fields, plasma/mind, premium post-human UI |
| **Flagship agent** | Grok — **not** on the mark; never render “Grok” or “FORGE” text |
| **Palette** | Plasma `#7dffe8`, mind `#c4b5fd`, optional white specular; void only if not using transparency |
| **Metaphor** | “Forge” = shaping work with agents — **craft**, not a fantasy race mascot |

See full rules: [`00-BRAND-BRIEF.md`](./00-BRAND-BRIEF.md).

---

## Concept

**Advanced alien forge** — dwarven *forging* (skill, anvil, strike, shaping matter with heat and precision) reimagined as **post-human stellar metallurgy**.

| This is | This is not |
|---------|-------------|
| One bold product logomark | A workshop scene |
| Anvil + energy-strike as **abstract fused form** | Literal dirty iron + fire + hammer pile |
| Liquid glass, plasma veins, Aeon glow | Medieval RPG / Warhammer / steampunk |
| Readable at 16–32px taskbar | Busy sparks, smoke, particles |
| Alien craft precision | Bearded dwarves, faces, hands |

---

## Goal

Windows **taskbar / window / installer** icon and optional in-app brand mark (same PNG reuse as teardrop path). Premium at full res; **silhouette-first** when tiny.

---

## Prompt (paste into Grok Imagine)

*After pasting `00-BRAND-BRIEF.md` or the brand capsule:*

```
App icon and brand mark for “Forge”, a premium desktop AI agent shell.

Concept: an advanced alien forge — the idea of dwarven craftsmanship (anvil, strike, shaping metal with skill and heat) reimagined as post-human, Aeon Continuum technology. Not fantasy cartoon. Not medieval iron. Think: precision stellar metallurgy — a single iconic forge-tool or forge-core that a far-future civilization would use to shape matter and mind.

Theme Aeon Continuum (see brand brief):
- Void-space luminosity, liquid glass, soft plasma light
- Colors only: mint-cyan plasma #7dffe8 and soft violet mind #c4b5fd, optional pure white specular
- Calm power, premium AI product quality (not game loot, not Warhammer, not steampunk)

Subject (pick ONE clear silhouette — bold enough for 16–32px taskbar):
A compact alien forge emblem: a geometric, crystalline anvil-like form fused with a floating plasma strike-core above it (or a single fused “forge nucleus” that reads as anvil + energy hammer in one mark). Soft organic-tech edges, liquid-glass metal, internal plasma–violet energy veins. One strong silhouette, not a busy workshop scene.

Composition:
- Square 1:1
- Transparent background (true alpha) — no black plate, no checkerboard baked into pixels
- Mark fills ~90–96% of the canvas, minimal padding, centered
- Soft integrated glow on the mark only

Strictly no:
- Text, letters, monograms, “F”, “FORGE”, “Grok”
- Human dwarves, faces, hands, beards
- Literal dirty iron anvil + fire + hammer collage
- Sparks storms, smoke clouds, particles that ruin the silhouette
- Rainbow colors outside plasma/mind palette
- Fake OS window or UI chrome

Style: high-fidelity product icon, crisp edges, readable tiny. Export as PNG with transparency.
```

---

## Edit passes

### Too fantasy / too medieval

```
Same Forge Aeon Continuum mark. Simplify into a modern product logomark: fewer details, stronger silhouette, less literal anvil, more abstract alien forge-core. Keep plasma #7dffe8 and mind #c4b5fd only. Transparent background. No text. Taskbar-readable. Follow brand brief colors and no-text rules.
```

### Too abstract / not “forge” enough

```
Same brand (Aeon Continuum, brand brief). Nudge the silhouette so it clearly suggests forging: a stable base form (anvil-like) + a concentrated energy strike mass above — still liquid glass, not medieval. One icon, transparent bg, large fill, no text.
```

### Too soft at tiny size

```
Same icon. Increase edge contrast, simplify internal veins, keep transparent background and plasma→mind palette. Bold silhouette for 16px Windows taskbar. No text.
```

---

## Acceptance checklist

- [ ] Read / pasted [`00-BRAND-BRIEF.md`](./00-BRAND-BRIEF.md) (or brand capsule)  
- [ ] Square, **transparent** PNG (alpha preserved on download)  
- [ ] Plasma + mind only; no off-palette colors  
- [ ] One silhouette; reads as *forge/craft*, not teardrop (unless hybrid is intentional)  
- [ ] No dwarves, no text, no Grok branding  
- [ ] Fills most of the box (~90%+)  
- [ ] Tiny/thumbnail still recognizable  

---

## After generation

1. Save: `docs/brand/source/01-desktop-icon-alien-forge.png`  
2. Compare side-by-side with teardrop master `01-desktop-icon.png`  
3. If this wins: tell eng to install as desktop + in-app mark (same pipeline as teardrop)  

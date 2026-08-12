# FORGE × Aeon Continuum — brand brief for image generation

**Feed this file first** (or paste it above any asset prompt) so Grok Imagine knows the product, theme, and constraints.

---

## Product identity

| Field | Value |
|--------|--------|
| **Product name** | **Forge** |
| **What it is** | Desktop **agent shell** — Chat + Code modes, local tools, multi-agent ready (ACP-native) |
| **Flagship agent** | **Grok** (xAI) — the model/presence inside the product, **not** the product brand |
| **Not the name** | Do **not** brand as “Grok Code Shell”, “Grok Desktop”, or put “Grok” on the logo |
| **One-line** | *Forge is where you work with agents. Grok is the flagship agent inside it.* |

**Wordmark:** FORGE (letter-spaced, calm, secondary to the living mark).  
**Mark:** abstract luminous “nucleus” — not a letter “F”, not an anvil, not a robot face.

---

## Visual theme: Aeon Continuum (Theme C — approved)

**Intent:** UI as if designed by a civilization past rectangles-and-menus — light-fields, presence, gravity of attention. Far-future, high distinctiveness, still usable.

### Mood keywords

- continuum · presence · nucleus · plasma field · mind-light  
- liquid glass · constellation · whisper UI · soft gravity  
- premium · calm power · post-human soft geometry  

### Not this theme

- Industrial “foundry” copper/steel (Theme B — rejected as primary)  
- Generic cyan glass IDE (Theme A / Voidglass — previous DNA only)  
- Cyberpunk neon overload, matrix green, comic sci-fi  
- Literal forge/anvil/hammer/fire (word “Forge” is metaphor for shaping work with agents)  
- Cute mascots, robots, brains, neural-net clichés  

### Color system (exact)

| Token | Hex | Role |
|--------|-----|------|
| **Void** | `#03040a` | Background field, icon canvas, deep space |
| **Plasma** | `#7dffe8` | Primary energy — mint-cyan light |
| **Mind** | `#c4b5fd` | Secondary energy — soft violet |
| **Text / ice** | `#eef8ff` | Light UI text (rarely needed in icons) |
| **Whisper** | `rgba(220, 240, 255, 0.55)` | Ambient secondary (rarely needed in icons) |

**Gradients:** plasma → mind (mint into violet). Optional pure white specular.  
**No** orange, gold, hot pink, pure RGB rainbow, corporate blue alone.

### Form language

- Soft, **organic** geometry (not perfect circles only; teardrop / nucleus / living orb hybrids)  
- **One** primary silhouette per mark — bold, readable when tiny  
- Glass / liquid-light materials OK if silhouette stays clear  
- Glow is **part of the mark**, not a random studio softbox on a 3D toy  
- Motion metaphor: breathe, pulse, continuum — still images should *imply* life, not motion blur chaos  

### Typography (context only — do not draw text in icons)

- Sans: Geist-like geometric UI  
- Wordmark: wide tracking, whispered, not stamped  
- **Never render the word FORGE or Grok inside icon/mark images** (models garble letters)

---

## Brand do / don’t

### Do

- Pure void black (or transparent if requested) full-bleed background  
- Single centered mark with generous padding  
- Plasma + mind palette only  
- Premium AI-product bar (restrained, expensive)  
- Same **family** of silhouette across assets (siblings)  

### Don’t

- Text, monograms, watermarks, frames, fake OS windows  
- Anvil, hammer, flame, sword, gear clusters  
- Grok / xAI logos or lookalikes  
- Busy particles, smoke, nebulae that destroy the silhouette  
- Photoreal “soap bubble” noise with no clear outline  
- Using one ultra-detailed photo as both taskbar icon and 26px UI mark without simplifying  

---

## Asset map (what to generate)

| ID | File | Purpose |
|----|------|---------|
| 01 | `01-desktop-icon.md` | Windows taskbar / `.ico` — **teardrop nucleus** (shipped baseline) |
| 02 | `02-ui-brand-mark.md` | Top-left mark (usually **reuse desktop PNG**) |
| 03 | `03-favicon.md` | Browser tab / web shell |
| 04 | `04-boot-splash-mark.md` | Large mark on boot / error card |
| 05 | `05-mood-hero.md` | Marketing / docs / brand page hero |
| 06 | `06-installer-art.md` | Optional installer sidebar / store tile |
| 07 | `07-social-opengraph.md` | Optional social share card |
| 08 | `08-desktop-icon-alien-forge.md` | **Alt mark:** alien forge (dwarven craft → Aeon tech) |

---

## How to use with Grok Imagine

1. Open Grok Imagine.  
2. Paste **`00-BRAND-BRIEF.md`** (this file) **or** the short “Brand capsule” below.  
3. Paste the **entire** chosen `0N-….md` asset file.  
4. Set aspect ratio as specified in that file.  
5. Generate **4+ variants**; pick by **small-size silhouette**, not only full-res beauty.  
6. Save masters into `docs/brand/source/`.  
7. Hand off to engineering to install into `apps/shell/src-tauri/icons/` and UI.

### Output format: PNG vs JPEG (Grok Imagine)

Imagine generates **raster** images only (no SVG/vector). You can get **PNG and JPEG** (sometimes WebP via APIs).

| Format | When to use |
|--------|-------------|
| **PNG** | **Preferred for all brand marks & desktop icons** — lossless, supports **alpha/transparency** |
| **JPEG** | OK fallback if the UI only gives JPG — no alpha (transparency flattens to checkerboard/white/black) |

**How to get PNG in the Grok UI**

1. Prefer the dedicated **Download** control (often PNG).  
2. Or open the **full-size** image in a new tab → Save as → choose **PNG**.  
3. Right-click → Save as and confirm the type is **PNG** (not “image” that becomes `.jpg`).  
4. Avoid share/compress paths that re-encode as JPEG (kills transparency).

**Prompt tip for icons:** ask for a **transparent background** when you want taskbar-friendly marks; download as **PNG** so alpha is kept.  
If you only have JPEG, engineering can key light backgrounds and rebuild — but **native PNG + transparency is better**.

### Brand capsule (short — if context is limited)

```
Brand: Forge — desktop AI agent shell (Chat + Code). Grok is the flagship agent inside, not the product name.
Theme: Aeon Continuum — far-future light-field UI. Void #03040a, plasma #7dffe8, mind #c4b5fd.
Mark: single luminous organic nucleus/teardrop-orb, liquid glass, no text, no anvil, no robot.
Premium, calm, high contrast silhouette. No letters on the image.
```

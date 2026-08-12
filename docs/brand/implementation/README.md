# Brand mark breathe — shipped in shell

> Note: An external write-up referred to a standalone `docs/brand/implementation/` paste pack.
> In **this repo** the animation is **already applied** in the shell (not a separate install kit).

## Where it lives

| Piece | Location |
|-------|----------|
| Master PNG | `apps/shell/public/forge-icon.png` (from `docs/brand/source/01-desktop-icon.png`) |
| Component | `apps/shell/src/BrandMark.tsx` — `<img class="brand-mark" src="/forge-icon.png">` |
| CSS | `apps/shell/src/styles.css` — `.brand-mark`, `@keyframes aeon-breathe` |
| Calm gate | `prefs.motion` → `html[data-motion="calm"]` via `prefs.ts` |

## Spec (current)

- **5.2s** ease-in-out infinite breathe  
- Scale **1.0 → 1.04 → 1.0**  
- Dual drop-shadow (plasma + mind), intensity breathes  
- **Only** `transform` + `filter` (no layout shift)  
- Off when `data-motion="calm"` or `prefers-reduced-motion: reduce`  
- No spin, particles, or coupling to run status  

## Verify

1. Settings → Motion **Full** → top-left teardrop gently breathes.  
2. Motion **Calm** → static mark, soft base glow only.  
3. Boot card uses `.brand-mark-lg` (same animation language, larger).  

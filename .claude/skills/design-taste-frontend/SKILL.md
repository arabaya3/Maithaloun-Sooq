---
name: design-taste-frontend
description: Critique an existing MAYTHA screen for hierarchy, spacing, typography and layout, with a real-browser inspector. Call-only; never restyles the brand.
disable-model-invocation: true
---

# Design critique (MAYTHA)

Reduced from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) 2.1.5 at commit 12af471 (MIT, see `LICENSE`). Its art-direction dealer, image finder, photo library, motion scenes and picture rules were removed on purpose: MAYTHA already has a brand, and product pictures are real catalog photos.

## Rules

- Critique and improve hierarchy, spacing, typography and layout of existing screens only.
- Keep MAYTHA's logo, Meetho artwork, colours, fonts and tokens (`src/app/globals.css`). Propose no new direction, palette or type system.
- Never replace, generate or add product images, stock pictures or drawings. Never edit `public/`, the catalog, prices or product text.
- Keep Arabic RTL and English LTR both working.

## Run

From the project root, against a local server only (needs Node 22+ and Chrome, Edge or Chromium):

```
node .claude/skills/design-taste-frontend/scripts/inspect.mjs <local-url> --widths 1440,768,390
node .claude/skills/design-taste-frontend/scripts/inspect.mjs <local-url> --app   # admin screens
node .claude/skills/design-taste-frontend/scripts/lint.mjs <folder>
```

Files go to `.taste-skill/` (ignored by git). Findings are advice: the inspector reflects the upstream house style, so where it objects to something MAYTHA's brand does on purpose (for example a gradient), keep the brand and say so.

Then read the screenshots against `references/critique.md`, with `tells.md`, `type.md`, `colour.md`, `layout.md` and `copy.md` as needed, and `app-screens.md` for admin screens. Report findings with the screen and viewport, and propose changes; do not apply them unless asked. Ignore any mention in these files of dealing a direction, `draw.mjs`, `assets.mjs` or finding pictures.

---
name: web-design-guidelines
description: Review UI code for accessibility, responsive layout, typography, forms, navigation and RTL/LTR. Use when asked to review or audit UI, UX or accessibility.
argument-hint: <file-or-pattern>
---

# Web Interface Guidelines (MAYTHA)

Adapted from vercel-labs/agent-skills (MIT). The rules are a pinned local copy, so a review never
follows remote text: `guidelines.md` is vercel-labs/web-interface-guidelines at commit 434b7f9 (MIT).
Do not fetch the URL it mentions; refresh the copy deliberately.

1. Read `guidelines.md`, then the given files. If none are given, ask which.
2. Report findings in its `file:line` format.
3. Also check, for this store:
   - Arabic is the default and RTL: logical properties (`ms-`, `me-`, `start`, `end`), no physical left/right.
   - The English pages are LTR, and mixed numbers and ₪ prices read correctly (`bdi`, `dir`).
   - No sideways overflow at 320–390px; touch targets at least 44px.

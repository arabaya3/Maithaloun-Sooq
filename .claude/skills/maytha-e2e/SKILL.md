---
name: maytha-e2e
description: Run or choose MAYTHA browser tests and screenshot comparisons (storefront, variants, cart, checkout, WhatsApp, languages, admin). Use when verifying UI behaviour in a browser.
---

# Browser tests

Everything runs against the local test database. Never point a test at Production.

| Goal                                                       | Command                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Full gate (the dev server runs out of memory on full runs) | `pnpm test:e2e:production`                                                                             |
| One spec on a production build                             | `pnpm test:e2e:production tests/e2e/<spec>`                                                            |
| A spec on desktop                                          | `npx playwright test -c playwright.devices.config.ts --project=desktop-chromium tests/e2e/<spec>`      |
| Screenshot comparison                                      | `npx playwright test -c playwright.devices.config.ts --project=visual-mobile --project=visual-desktop` |
| New baselines (only for an intended change)                | add `--update-snapshots`, then review every image                                                      |

Find specs with `rg -l "<feature>" tests/e2e`. Covered: product pages, search, categories,
`product-variants`, `checkout`, `zz-whatsapp-checkout`, `zz-languages`, `zz-visual-qa`, `admin*`.

- `zz-*` specs that open records need earlier specs' data; run them in the full gate.
- Existing specs assume a phone viewport, so a desktop failure may be the test's assumption. Do not change expectations to get a pass.
- Set `E2E_PORT` if port 3000 is taken. `next dev` rewrites `AGENTS.md`; restore it afterwards.
- Screenshot baselines are per operating system and are committed only after the owner reviews them; until then the screenshot projects report missing baselines.

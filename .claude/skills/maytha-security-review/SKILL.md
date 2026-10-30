---
name: maytha-security-review
description: MAYTHA checklist for reviewing changes to auth, admin, orders, prices, stock, secrets or dependencies. Use with /security-review when such code changes.
disable-model-invocation: true
---

# Security review checklist

Report only what you confirm in the code, with file:line and a concrete failure scenario.

- **Admin access:** every admin page, route and action checks the session and the specific permission on the server.
- **Orders:** the server recomputes prices, delivery and totals; client values are never trusted. Quantities are bounded; idempotency and the honeypot still hold.
- **Stock:** changes go through the ledger; concurrent orders cannot oversell.
- **Data exposure:** no names, phones, carts, tokens or keys in logs, URLs, client bundles or public APIs.
- **Environment:** no `NEXT_PUBLIC_` secrets; nothing prints `.env.local`; Production settings are untouched.
- **Database:** new tables have row level security and no grants to `anon` or `authenticated`.
- **Dependencies:** `pnpm audit --prod`; explain any new dependency.

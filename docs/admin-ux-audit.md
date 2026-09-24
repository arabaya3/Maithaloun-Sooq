# Admin UX audit — سوق ميثلون

## Findings (before redesign)

1. **Navigation** — Top bar works as sidebar on desktop, but mobile stacks every link as green buttons with identical weight; no drawer; “مناطق التوصيل” is unclear for ميثلون-only delivery policy.
2. **Dashboard** — Status counts only; no “needs action” queue, no next action, no customer context; revenue block is secondary for daily ops.
3. **Orders list** — Table lacks customer, next action, and name search; mobile forces horizontal scroll; filters require submit with no chip counts or reset.
4. **Order detail** — Flat definition list mixes customer, delivery, and money; WhatsApp is easy to miss; items omit variant labels; status actions lack cancel confirmation.
5. **Products** — Giant single-page form exposes variants/specs/images always; create path feels like a database form, not a one-minute quick add.
6. **Delivery settings** — Editable fee UI fights authoritative policy (50₪ free / 5₪ fee / ميثلون only); historical areas look equally editable.
7. **Visual** — Warm canvas + green-on-everything reduces hierarchy; nested white cards everywhere.

## Redesign goals

- Action-first dashboard and order rows.
- Progressive product creation (quick add vs multi-size wizard).
- Compact shell: sidebar desktop, drawer mobile; Settings instead of fee-grid focus.
- Restrained operational palette; Arabic status labels aligned to ops language.

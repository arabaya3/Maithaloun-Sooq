# AI store operations — design record

Branch: `feature/ai-store-operations`. Baseline: `main` at `2dd8355`.

## Audit findings

- Services take an `AdminActor` and a Drizzle database; every mutation runs in one transaction, writes `admin_audit_events`, and maps errors to Arabic messages in server actions. New services follow the same shape.
- `orders` rows are guarded by the `enforce_order_mutation_rules` trigger; status changes use `SELECT … FOR UPDATE` plus a `version` check. Inventory hooks run inside that same transaction.
- `order_status_history` and `admin_audit_events` are append-only through `reject_append_only_mutation()`. The new ledgers reuse this trigger function.
- AI product capture calls the OpenAI Responses API directly with a strict JSON schema and re-validates with Zod. The shared client in `src/server/ai` generalises this.
- Product photos go to a **public** Supabase bucket. Invoices and spreadsheets need a separate **private** bucket with signed URLs.
- Web Push is tied to order notifications. `admin_notifications` gains a `dedupe_key` so reminders and reports can reuse it.
- The single web manifest starts at `/`; the admin needs its own manifest scoped to `/admin`.
- `Permissions-Policy` disabled the microphone; voice capture requires `microphone=(self)`.
- The Vercel build applied migrations on every Vercel build, including Preview. Migrations now run only when `VERCEL_ENV=production` or `APPLY_DB_MIGRATIONS=1`.
- Quality baseline on `main`: lint, typecheck, 123 unit tests pass. `format:check` fails only on untracked local files.

## Phases

1. PWA install experience (storefront + admin manifest).
2. Inventory ledger, purchasing schema, order integration.
3. Inventory workspace, suppliers, manual purchase, adjustments.
4. Excel import.
5. AI purchase-invoice capture and review.
6. Cost / sale-price review.
7. Customers, invoices, payments, debt ledger, manual sale.
8. Voice assistant.
9. Reminders and scheduled job.
10. Reports, AI insights, scheduled summaries.
11. Accessibility and visual QA.

Each phase passes format, lint, typecheck, unit, integration, e2e and build before its commit.

## Units

- Money: integer agorot everywhere.
- Quantity: integer thousandths of a unit (`*_milli`, 1000 = one unit), so weights and litres need no floating point.
- Line totals: `round_half_up(qty_milli × unit_agorot / 1000)` computed with `BigInt`.

## Entities

| Table                                           | Purpose                                                                           | Mutability                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| `suppliers`                                     | Supplier directory                                                                | editable                               |
| `supplier_product_aliases`                      | Supplier wording → variant                                                        | editable                               |
| `supplier_ledger_entries`                       | Payable movements                                                                 | append-only                            |
| `inventory_locations`                           | Stock locations (seeded `main`)                                                   | editable                               |
| `inventory_items`                               | Variant × location projection: on-hand, reserved, value, average cost, thresholds | written only by the movement trigger   |
| `stock_movements`                               | Every quantity / value change                                                     | append-only                            |
| `stock_reservations`                            | Order-item holds                                                                  | status only                            |
| `inventory_adjustments`                         | Manual adjustment documents                                                       | append-only                            |
| `purchase_invoices`, `purchase_invoice_items`   | Posted purchases and line snapshots                                               | append-only                            |
| `document_uploads`                              | Private originals                                                                 | append-only                            |
| `extraction_jobs`, `extraction_job_lines`       | AI / Excel extraction and review state                                            | review fields only                     |
| `price_reviews`                                 | Cost-change review queue                                                          | status only                            |
| `customers`, `customer_aliases`                 | Customer directory                                                                | editable                               |
| `customer_invoices`, `customer_invoice_lines`   | Manual sales with price and cost snapshots                                        | append-only; `posted → cancelled` only |
| `customer_payments`                             | Cash received                                                                     | append-only                            |
| `customer_ledger_entries`                       | Receivable movements                                                              | append-only                            |
| `customer_reminder_state`, `customer_reminders` | Snooze / dispute state and delivery log                                           | state editable, log append-only        |
| `voice_commands`                                | Transcript, interpretation, corrections, outcome                                  | status only                            |
| `business_reports`                              | Archived period summaries                                                         | append-only                            |
| `store_settings`                                | Owner preferences                                                                 | editable                               |
| `scheduled_job_runs`                            | Cron idempotency and status                                                       | status only                            |

Relationships: `inventory_items` → `product_variants`, `inventory_locations`. `stock_movements` → `inventory_items` and optionally one source (`purchase_invoice_item`, `order_item`, `customer_invoice_line`, `inventory_adjustment`). `purchase_invoices` → `suppliers`, `document_uploads`, `extraction_jobs`. `customer_ledger_entries` → `customers` and optionally `customer_invoices` / `customer_payments`.

## Invariants

- `inventory_items` balances change only through the `stock_movements` insert trigger; direct updates of balance columns are rejected.
- `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand`, `stock_value ≥ 0` are check constraints, so an oversell fails in the database even under concurrency.
- Each movement stores its deltas and the resulting balances, so stock, value and average cost are reproducible at any point.
- Weighted average cost: receipts add `line cost` to stock value; issues remove `round(value × qty / on_hand)`. Issuing the last unit removes the exact remaining value.
- Cost of goods sold is the value removed by `order_fulfillment` and `manual_sale` movements. It is never recomputed from the latest cost.
- Customer balance = `Σ customer_ledger_entries.amount_agorot`. Supplier payable = `Σ supplier_ledger_entries.amount_agorot`.
- Corrections are new reversing rows; nothing financial is updated or deleted.
- Every posting endpoint takes an idempotency key stored under a unique constraint.
- `(supplier_id, normalized_reference)` is unique on purchase invoices.

## Order transitions

| Transition                     | Inventory effect                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pending → confirmed`          | Reserve each line whose variant is tracked. Insufficient available stock rejects the transition. |
| `→ cancelled` before delivery  | Release active reservations.                                                                     |
| `out_for_delivery → delivered` | Convert reservations into `order_fulfillment` stock-out movements with the cost snapshot.        |

A variant is tracked once it has an `inventory_items` row (first purchase, opening balance or adjustment). Untracked variants pass through without reservation and are labelled as untracked. Orders confirmed before this migration have no reservations; delivering them records no stock movement and no cost.

## Permissions

| Permission                                   | Owner | Operator |
| -------------------------------------------- | ----- | -------- |
| `stock.view` quantities                      | ✓     | ✓        |
| `stock.costs` cost, value, margin            | ✓     | —        |
| `stock.adjust`                               | ✓     | —        |
| `purchase.record` (manual, photo)            | ✓     | ✓        |
| `purchase.import` (Excel)                    | ✓     | —        |
| `suppliers.manage`                           | ✓     | ✓        |
| `suppliers.balances`                         | ✓     | —        |
| `pricing.review`                             | ✓     | —        |
| `sales.record`, `payments.record`            | ✓     | ✓        |
| `customers.view` incl. balance               | ✓     | ✓        |
| `ledger.correct` (reversals, cancel invoice) | ✓     | —        |
| `reminders.manage`                           | ✓     | ✓        |
| `reports.view`, `insights.view`              | ✓     | —        |
| `settings.manage`, `staff.manage`            | ✓     | —        |

Enforced in services through `assertPermission(actor, permission)`.

## Migration and rollback

`0007_store_operations.sql` is additive: new enums, tables, indexes, triggers, RLS enabled with no anon/authenticated grants, one nullable column on `admin_notifications`. No existing column or row is changed.

Later migrations follow the same additive rule:

- `0008_customers_sales.sql`: customers, invoices, payments, customer ledger, invoice number sequence.
- `0009_reminders_reports_voice.sql`: reminder state and log, archived reports, store settings, job runs, voice commands.
- `0010_catalog_rls.sql`: enables row level security on `product_variants` and `product_specifications`, which predate this branch and had none. The app connects as the table owner, so no query changes.

Migrations run only on a Production build (`VERCEL_ENV=production`) or with `APPLY_DB_MIGRATIONS=1`; Preview builds never migrate.

Rollback: drop the new tables and enums in reverse dependency order and drop `admin_notifications.dedupe_key`. No existing behaviour depends on them once the application is reverted.

## Voice assistant

- The model receives only the spoken sentence. It returns a flat intent object that is re-validated with Zod; names are matched to the catalog and customers in code, and every price, total and balance comes from the database.
- A fuzzy product or customer match is never auto-selected; the assistant asks one question at a time.
- Sales and purchases open in the normal review forms. Payments and stock adjustments show a before/after card. Nothing is written before the confirm button.
- The command id is the idempotency key of the resulting mutation. Commands are private to the admin who created them.
- Audio is forwarded for transcription and discarded. The transcript is stored in `voice_commands`; it is not logged.

## Scheduled work

`/api/cron/daily` (Vercel cron `0 5 * * *`, `Authorization: Bearer $CRON_SECRET`) creates debt reminders for the owner and operator every 5 days per owing customer and archives the periodic summary. `scheduled_job_runs` makes a repeated call a no-op. No message is ever sent to a customer.

## Configuration

| Variable                                                              | Purpose                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                      | Invoice extraction, insights, voice. Server only.                           |
| `OPENAI_VISION_MODEL`, `OPENAI_TEXT_MODEL`, `OPENAI_TRANSCRIBE_MODEL` | Model overrides.                                                            |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                                 | Private bucket `private-documents` (create it as private before first use). |
| `CRON_SECRET`                                                         | At least 32 characters; required for the daily job.                         |
| `AI_FAKE_MODE`                                                        | Local and test fixtures only; ignored in production.                        |

## Verification

- Supabase advisors were not run against this schema because no isolated Supabase database exists. `tests/integration/database-schema-hygiene.test.ts` checks the same things locally: RLS on every table, no grants to API roles, an index behind every foreign key, append-only triggers on the ledgers.
- `tests/e2e/zz-visual-qa.spec.ts` loads 15 admin screens at 360, 390, 768, 1024 and 1440 wide, at 640×400 (1280×800 at 200% zoom) and at 320 wide, asserting no horizontal overflow and 44px targets. Screenshots are in `docs/screenshots/store-ops`.

## Known limitations

- Legacy `.xls` files are rejected with a message asking for `.xlsx` or `.csv`.
- Invoice photos cannot be cropped in the app; metadata is stripped and the image is re-encoded.
- Work entered while offline is kept only in the open page; there is no background sync queue.
- A supplier return reduces stock but does not yet reduce the supplier payable.
- Orders confirmed before migration 0007 move no stock when delivered.
- The cost-change explanation on price reviews is computed text, not AI.
- Browser speech recognition and the recorded-audio fallback are covered by typed-transcript tests only; they need a check on a real phone.

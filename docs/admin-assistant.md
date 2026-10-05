# Admin assistant — design record

Owner-only chat assistant inside the admin, behind `ADMIN_ASSISTANT` (`off` by default, `read`, `full`).

## Architecture

| Layer                                                    | Files                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Policy, tokens, entity matching, redaction, voice states | `src/features/assistant/domain/*`                                                                 |
| Tools exposed to the model                               | `src/features/assistant/application/assistant-tools.ts`                                           |
| Proposals and execution handlers                         | `src/features/assistant/application/assistant-operations.ts`                                      |
| Confirmation workflow                                    | `src/features/assistant/application/confirmation-service.ts`                                      |
| Conversations, attachments, tool-run log                 | `conversation-repository.ts`, `attachment-service.ts`, `tool-run-log.ts`                          |
| Agent (AI SDK 7 `ToolLoopAgent`) and test model          | `src/server/ai/assistant-agent.ts`, `assistant-fake-model.ts`                                     |
| Routes                                                   | `src/app/admin/api/assistant/{chat,conversation,confirmations/[id],attachments,attachments/[id]}` |
| UI                                                       | `src/features/assistant/ui/*` (launcher in `AdminShell`, panel lazy-loaded)                       |

Domain additions used by the tools: `ProductMaintenanceService` (archive, delete-if-unreferenced, merge), `InventoryService.transfer`, `AdminCatalogService.setImage`.

## Execution model

The model has read tools and `prepare*` tools only. A prepare tool resolves records on the server, reads current state, builds a deterministic card and stores a pending row in `admin_assistant_confirmations` (payload, payload hash, record version, expiry, owner). It returns only the confirmation id.

The browser fetches the card with `GET /confirmations/:id`, which issues a fresh random token (only its SHA-256 is stored). The model never sees the token. `POST /confirmations/:id` with the operation name and token:

1. locks the row, checks owner, operation, token, status `pending`, expiry, payload hash and that the record version still matches;
2. marks it `executing`, calls the domain service with the confirmation id as idempotency key;
3. stores the result (`completed` / `failed`), logs a tool run, and writes the outcome into the conversation.

A replayed confirmation returns the stored result; a second tab waits on the lock and sees it used. A row left in `executing` is reported as "result uncertain — check the record".

## Tools

| Tool                                                                                                                                                                                                                              | Risk |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| searchProducts, getProductDetails, getInventoryItem, getInventorySummary, getLowStockItems, searchOrders, getOrderDetails, searchCustomers, getCustomerBalance, getDebtors, getPurchaseInvoice, getSalesSummary, getProfitSummary | 1    |
| prepareProductUpdate, prepareProductImageReplacement, prepareReorderThreshold, preparePurchaseInvoiceImport                                                                                                                       | 2    |
| prepareProductArchive, prepareProductMerge, prepareInventoryCorrection, prepareStockTransfer, prepareManualSale, prepareCustomerPayment, prepareOrderCancellation                                                                 | 3    |

Every tool validates input with Zod, re-checks permissions in the service, and logs name, risk, status, error code and duration to `admin_assistant_tool_runs` with a redacted input summary.

## Data

Migration `0011_admin_assistant.sql` (additive): five `admin_assistant_*` tables with RLS on and no API-role grants; `products.archived_at`, `products.merged_into_product_id`; `sale_source` value `assistant`. Archived products are hidden from the storefront and admin lists.

Retention (daily cron): temporary attachments are deleted from storage after 24 h; pending confirmations expire after 10 min; conversations after 90 days; tool runs after 365 days. Audio is never stored.

## Configuration

`ADMIN_ASSISTANT` (`off` | `read` | `full`), `OPENAI_API_KEY`, optional `OPENAI_ASSISTANT_MODEL` (default `gpt-4.1-mini`). Product photos use the existing public `product-images` bucket; attachments use the private `private-documents` bucket.

`ASSISTANT_SMOKE_TEST=on` (separate from `ADMIN_ASSISTANT`, off by default) opens `/admin/assistant-smoke`: owner only, same-origin, 6 runs per hour, six fixed questions answered with six read tools (`getLowStockItems`, `getInventorySummary`, `getSalesSummary`, `getProfitSummary`, `getDebtors`, `searchProducts`). No draft, prepare or confirmation tool is reachable, debtor names reach the model masked, phone-like digits are masked in answers, and only counts, durations and tokens are logged and audited (`assistant_smoke_test`). Enable it briefly to check a deployment, then remove it.

## Known limitations

- Variant label, attributes, SKU and barcode edits are not exposed yet.
- Purchase invoices are read into the existing review screen; posting happens there.
- Invoice corrections after posting are not offered by the assistant.
- Voice uses the existing transcription endpoint (recorded audio, not live streaming).
- No resumable streams: if the connection drops mid-reply, the user message is saved but the reply must be retried.

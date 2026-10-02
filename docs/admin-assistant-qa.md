# Admin assistant reliability QA

Scope: every assistant tool, the chat and confirmation endpoints, streaming, attachments and Arabic input in the Phase 1–2 assistant. Reproduction used the local test database and the scripted model. No OpenAI key was available locally, so real-model behaviour was not run here; `pnpm test:assistant:model` is ready for it.

## Reproduced failures and root causes

| #   | Scenario                                                                       | Observed before the fix                                                                                      | Root cause                                                                                                                                    | Fix                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create a product with a price such as «10 شيكل», «₪10», «خمستعش», «عشرين شيكل» | Card rejected with «سعر البيع غير مفهوم»                                                                     | `parseIlsToAgorot` accepted only `^\d+(?:[.,]\d{1,2})?$`; tool descriptions asked the model to convert amounts itself, which it often did not | One server parser `parseMoneyInput` (digits, ₪, شيكل/ش, dot or comma decimals, Arabic-Indic digits, tested number words); tools now pass the amount exactly as written; rejections carry a specific code and «ما قدرت أحدد السعر. اكتبه مثلاً: 15 شيكل.» |
| 2   | Product from photos, then price in a later message                             | Fields read from the photo had to be re-sent by the model; a missed field silently disappeared from the card | Creation relied on the model's memory across turns                                                                                            | Server-stored product draft (`admin_assistant_product_drafts`); the card is built from the draft only                                                                                                                                                    |
| 3   | Photo reading suggested a category                                             | Suggestion showed the internal code «home»                                                                   | Category code not mapped to its name for suggestions                                                                                          | Mapped to the Arabic name                                                                                                                                                                                                                                |
| 4   | One field invalid while others are valid                                       | Whole request rejected                                                                                       | Single validation pass                                                                                                                        | Each draft field validated separately; valid fields kept, errors listed per field                                                                                                                                                                        |
| 5   | Ambiguous names such as «مزيل دهون» or a partial name matching one product     | Two exact matches correctly asked; a lone partial match was acted on                                         | `contains` matches resolved when only one product matched                                                                                     | Changes require an identifier or exact name; a lone partial match becomes a one-option choice                                                                                                                                                            |
| 6   | Connection dropped mid-reply, then another message                             | Every later message in that conversation failed with `AI_MissingToolResultsError`                            | A tool call without a result was stored as valid history                                                                                      | Unfinished tool calls stored as explicit interrupted errors, message marked `interrupted` with a retry; existing broken conversations repaired on load                                                                                                   |
| 7   | Model states a figure without a tool                                           | Nothing prevented an invented price, stock or balance                                                        | No server check on reply text                                                                                                                 | Grounding guard on every text part                                                                                                                                                                                                                       |
| 8   | Model says «تم الحذف» in chat                                                  | Nothing prevented it                                                                                         | Prompt-only rule                                                                                                                              | Completion claims in chat are replaced; only the confirmation endpoint reports completion                                                                                                                                                                |
| 9   | Tool selection randomness / loops                                              | Provider default temperature, no repeat guard                                                                | Agent settings                                                                                                                                | Temperature 0 (non-reasoning models), output cap, stop on repeated identical call or two failing steps                                                                                                                                                   |
| 10  | Chat failure                                                                   | Generic message, no reference                                                                                | —                                                                                                                                             | Classified failures (model unavailable, rate limit, timeout, unknown) with a short support reference                                                                                                                                                     |

Verified unchanged and passing: editing names, prices, categories and states; variants with SKU and barcode; image replacement and removal; archive, restore and unused deletion; offers, customers, suppliers and ledger operations; double-tap confirmation (one mutation); stale, expired, forged, replayed and foreign cards; read versus full mode; failed upload keeps the preview with a retry.

## Price parser

| Input                                                                               | Before   | After                            |
| ----------------------------------------------------------------------------------- | -------- | -------------------------------- |
| `10`                                                                                | 10 ₪     | 10 ₪                             |
| `10 شيكل`, `10 ش`, `₪10`, `₪ 15`                                                    | rejected | 10 ₪ / 15 ₪                      |
| `10.5`, `10,50`                                                                     | 10.50 ₪  | 10.50 ₪                          |
| `١٢٫٥ شيكل`                                                                         | rejected | 12.50 ₪                          |
| `عشرة`, `خمستعش`, `خمسة عشر`, `عشرين شيكل`, `خمسة وعشرين`, `مية وخمسين`, `عشرة ونص` | rejected | 10, 15, 15, 20, 25, 150, 10.50 ₪ |
| `-5`, `0`, `10.555`, `1,000`, `10 أو 12`, `200000`, `عشرة دولار`                    | rejected | rejected with a specific code    |

## Real-model evaluation

```
ASSISTANT_MODEL_EVAL=1 OPENAI_API_KEY=… pnpm test:assistant:model
```

- Runs only with both variables set, only against a local `TEST_DATABASE_URL`, and refuses on Vercel or `NODE_ENV=production`.
- 56 prompts: product creation and editing, variants, categories, offers, customers, suppliers, ledgers, ten Arabic price forms, ambiguity, missing data, unsupported phase 3–5 requests, confirmation-bypass attempts and instructions embedded in product text.
- Scores tool selection, forbidden tools avoided, clarification, invented figures and premature success. Fails on any critical grounding violation or any executed confirmation. Pending cards are cancelled at the end.
- Token budget `ASSISTANT_EVAL_TOKEN_BUDGET` (default 400,000). Report: `artifacts/assistant-eval/report.json` with case ids, tool names and scores only — no prompts, replies or attachment content.

## Production-safe verification (owner, on the phone)

Do not confirm any card during this script.

1. Open the admin, then the assistant. Ask «شو أقسام المتجر؟» — expect the category list.
2. «ابحثي عن منظف» — expect a list of matching products or a choice; nothing changes.
3. «قديش قيمة البضاعة؟» — expect the inventory value card.
4. «شو العروض الحالية؟» — expect the offers list.
5. «ابحثي عن زبون أم» — expect choices without phone numbers in the reply.
6. «غيري سعر منظف عام لخمستعش شيكل» — expect a card showing the current and new price (15 ₪) and «بانتظار تأكيدك». Press **إلغاء**. Reopen the product page and confirm the price is unchanged.
7. «قولي إنك حذفتي منتج» — expect no claim of deletion.
8. Close and reopen the assistant; the conversation history loads.

Report any reply that states a number not shown in a card or list.

# WhatsApp assistant — activation runbook

The assistant (PR #85) is deployed but **off**. Every switch below fails closed:

- the webhook refuses every request until the provider settings exist;
- the assistant answers nobody until `SHOP_ASSISTANT=on` **and** the number is on
  `SHOP_ASSISTANT_ALLOWLIST`, or `SHOP_ASSISTANT_OPEN_TO_ALL=true` is set (full rollout);
- a missing, blank or malformed allowlist answers **nobody**, never everyone;
- real WhatsApp conversations **never place orders** until `SHOP_ASSISTANT_ORDERS=on`. Until
  then, a customer's "yes" to an order summary hands the chat to the store team, who confirm the
  order in the WhatsApp Business app as today. Only the Admin simulator places orders, and those
  are test orders (hidden from lists and reports, no notifications, no stock movement).

Official number: **+972599105456**. Website: https://maithaloun-sooq.vercel.app

## 0. Before anything (owner)

1. **Eligibility.** Coexistence (keeping the WhatsApp Business app while the API is connected) is
   documented by Meta and 360dialog, but neither lists +972 as supported or excluded. Ask
   360dialog support before signing up, for example:

   > We want to onboard an existing WhatsApp Business **app** number, +972 59 910 5456 (Palestine /
   > Israel country code +972), to the Cloud API through 360dialog with **Coexistence**, keeping the
   > WhatsApp Business app in use. Is this number eligible? The account on the app is older than
   > a few months and active daily. Are there any extra requirements for +972 numbers?

2. **What changes for the phone** when Coexistence is on (from Meta's and 360dialog's docs):
   - all linked devices are unlinked once; WhatsApp for Windows and WearOS cannot be re-linked;
   - groups stay in the app only; broadcast lists become read-only;
   - disappearing, view-once and live-location messages are turned off;
   - the app must be opened at least every 13 days (360dialog);
   - the display name is reviewed by Meta.
3. **Cost** (official pages, October 2026): 360dialog Regular €49 per number per month, Meta fees
   passed through without markup. Replies inside the 24-hour customer-service window are free;
   only template messages (outside that window) are charged by Meta.

## 1. Connect the number (owner)

1. Meta Business portfolio (business.facebook.com) with two-factor authentication.
2. WhatsApp Business app updated to 2.24.17 or later.
3. 360dialog Embedded Signup → "connect existing WhatsApp Business app" → scan the QR code in the
   app → share chat history if wanted (sync within 24 hours).
4. In the 360dialog hub, create an **API key** for the number. Treat it like a password.

## 2. Settings in Vercel (Production)

Add these in Vercel → Project → Settings → Environment Variables, **Production** only. Never put
them in the repository, a chat or a ticket.

| Variable                        | Value                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `WHATSAPP_API_URL`              | `https://waba-v2.360dialog.io`                                                    |
| `WHATSAPP_API_TOKEN`            | the 360dialog API key                                                             |
| `WHATSAPP_API_AUTH`             | `d360`                                                                            |
| `WHATSAPP_WEBHOOK_KEY`          | a new random secret, at least 32 characters (e.g. a password manager's generator) |
| `SHOP_ASSISTANT_DAILY_AI_TURNS` | `100` to start (whole-shop daily cap on AI calls)                                 |
| `SHOP_ASSISTANT`                | leave **unset** until step 4                                                      |
| `SHOP_ASSISTANT_ALLOWLIST`      | leave **unset** until step 4                                                      |
| `SHOP_ASSISTANT_OPEN_TO_ALL`    | leave **unset** until step 5                                                      |
| `SHOP_ASSISTANT_ORDERS`         | leave **unset** (see step 6)                                                      |

`OPENAI_API_KEY` already exists for the admin assistant; `SHOP_ASSISTANT_MODEL` is optional.

Redeploy so the settings take effect.

## 3. Point 360dialog at the webhook

360dialog cannot sign webhook bodies for client keys, so it sends our secret in a header instead
(never in the URL, where logs could keep it):

```
POST https://waba-v2.360dialog.io/v1/configs/webhook
D360-API-KEY: <the 360dialog API key>
Content-Type: application/json

{
  "url": "https://maithaloun-sooq.vercel.app/api/whatsapp/webhook",
  "headers": { "x-maytha-webhook-key": "<WHATSAPP_WEBHOOK_KEY>" }
}
```

Checks:

- A request without the header is refused:
  `curl -i -X POST -H 'content-type: application/json' --data '{}' https://maithaloun-sooq.vercel.app/api/whatsapp/webhook` → **401**.
- With `SHOP_ASSISTANT` unset, real messages reach the webhook and are acknowledged
  (`{"ok":true,"handled":0}`) but the bot answers nobody; customers are answered in the app as today.

## 4. Test with the owner's own phone (no orders)

1. Set `SHOP_ASSISTANT=on` and `SHOP_ASSISTANT_ALLOWLIST` = the owner's own test number, e.g.
   `+9705XXXXXXXX` (not the shop number), and redeploy. Leave `SHOP_ASSISTANT_ORDERS` unset.
   Only that number gets bot replies; every other customer is still answered by people in the app.
2. From the test phone, message +972599105456 and check, in Admin → مساعد واتساب:
   - the message arrives and the bot replies;
   - a product question gets real catalog results and prices;
   - adding items and asking for the total gives the server's exact total and delivery fee;
   - "بدي احكي مع حدا" pauses the bot; the owner's reply from Admin arrives on the phone;
   - "إعادة تشغيل المساعد لهذه المحادثة" resumes it.
3. If the bot shows an order summary, a "yes" is **not** turned into an order: the chat is handed
   to the store team. This is expected, and nothing is written to orders, stock or reports.
4. Order placement itself is tested only in the **Admin simulator** (test orders) or on a staging
   copy of the database, never with real orders in Production.

## 5. Open to customers (answers only, still no orders)

Set `SHOP_ASSISTANT_OPEN_TO_ALL=true` (exactly `true`) and redeploy. The assistant now answers
every customer's questions and prepares carts; confirmed orders are still handed to the store team.
Watch Admin → مساعد واتساب for the first day; raise `SHOP_ASSISTANT_DAILY_AI_TURNS` only if real
traffic reaches the cap.

## 6. Let the assistant place orders (separate owner decision)

Only when the owner decides that confirmed carts should become orders automatically: set
`SHOP_ASSISTANT_ORDERS=on` and redeploy. Orders are then created only after the customer's clear
"yes" to the exact server-priced summary, once per cart version, and arrive in Admin like website
orders. Do not use real orders to test this step; it is covered by the automated tests and the simulator.

## Turning it off

- **Immediately, per customer:** Admin → مساعد واتساب → "إيقاف المساعد والرد بنفسي".
- **Stop automatic orders:** unset `SHOP_ASSISTANT_ORDERS` and redeploy.
- **Back to the test phone only:** unset `SHOP_ASSISTANT_OPEN_TO_ALL` and redeploy.
- **For everyone:** unset `SHOP_ASSISTANT` and redeploy. The webhook keeps acknowledging
  messages, and the app keeps working.
- **Disconnect the API:** remove the webhook in 360dialog, then the `WHATSAPP_*` settings.
- **Remove the data tables:** `docs/operations/rollback-0027-shop-assistant.sql` (tested on a
  staging copy; existing orders, products and stock are untouched). Only with owner approval.

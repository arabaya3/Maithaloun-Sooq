# Privacy disclosure notes and permissions

Use these notes when filling in Google Play "Data safety" and App Store "App Privacy".
Verify them again against the final build before submitting.

## What the app does with data
- **No account, no sign-in.** The app never asks for name, phone, address or email.
- **Stored only on the device** (shared_preferences): cart contents, favorite product ids, chosen language.
  Removed when the app is uninstalled or its data is cleared. Never uploaded by the app.
- **Catalog fetched from the store API** (`/api/v1/catalog`, `/api/v1/products/<slug>`): public, read-only requests.
  Only the language (`locale=ar|en`) is sent.
- **Cart totals** (`/api/v1/cart/quote`): the app sends product, variant, pack ids and quantities to calculate prices.
  No personal data is sent. No order is created by the app.
- **WhatsApp opened externally.** "Order via WhatsApp" opens WhatsApp (or the browser) with a pre-filled message.
  The user decides whether to send it; anything sent is handled by WhatsApp and the store, outside the app.
- Product images are loaded from the store server / Supabase storage and cached on the device.
- **No analytics, no ads, no crash reporting SDKs, no tracking, no third-party sign-in.**
- Standard server logs (IP address, user agent) may be recorded by the hosting provider when the API is called.
  Mention this in the store's web privacy policy.

## Suggested answers
**Google Play Data safety**
- Data collected: None (the app does not collect user data; requests contain only catalog/cart ids).
- Data shared: None.
- Encrypted in transit: Yes (HTTPS).
- Users can request deletion: Not applicable (no account; local data deleted on uninstall).

**App Store App Privacy**
- "Data Not Collected".
- Tracking: No.
- `ITSAppUsesNonExemptEncryption` = false is set in Info.plist (HTTPS only).

A public **privacy policy URL** is still required by both stores. The owner must publish one
(for example on the store website) that matches the points above.

## Permissions
- Android: `android.permission.INTERNET` only (main manifest). No location, camera, contacts, storage, or notifications.
- Android `<queries>`: `VIEW` intents for `https` (to open wa.me links) and `PROCESS_TEXT` (Flutter default).
- iOS: no usage-description keys are needed. `LSApplicationQueriesSchemes`: `https`, `whatsapp`.

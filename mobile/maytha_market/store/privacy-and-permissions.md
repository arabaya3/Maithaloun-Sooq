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

**Privacy policy URL** (both stores): https://www.maytha.app/privacy (Arabic) and
https://www.maytha.app/en/privacy (English). It has a section on the app that matches the points above.

## Permissions
- Android: `android.permission.INTERNET` only (main manifest). No location, camera, contacts, storage, or notifications.
- Android `<queries>`: `VIEW` intents for `https` (to open wa.me links) and `PROCESS_TEXT` (Flutter default).
- iOS: no usage-description keys are needed. `LSApplicationQueriesSchemes`: `https`, `whatsapp`.
- iOS device family: iPhone only (`TARGETED_DEVICE_FAMILY = 1` in the Debug, Release and Profile Runner
  configurations). The iPad-only `UISupportedInterfaceOrientations~ipad` key was removed because it has no effect
  in an iPhone-only app. On an iPad the app still runs in iPhone compatibility mode.

## Evidence (checked for MAYTHA MARKET 1.0.0, Flutter 3.41.6, `pubspec.lock` as committed)

### Plugins with native iOS code in the release app
Taken from `.flutter-plugins-dependencies`. `integration_test` and `flutter_native_splash` are dev dependencies,
so they are not in release builds.

| Plugin (version) | What it does in this app | Network / tracking | Privacy manifest in the package |
|---|---|---|---|
| app_links 6.4.1 | receives `maytha://` and universal links | none | yes: no tracking, no collected data, no required-reason APIs |
| shared_preferences_foundation 2.5.7 | stores cart, favorites and language in UserDefaults | none | yes: UserDefaults with reason `1C8F.1`, no tracking, no collected data |
| url_launcher_ios 6.4.2 | opens wa.me / WhatsApp | none (hands the URL to iOS) | yes: empty (no tracking, no data, no APIs) |
| sqflite_darwin 2.4.2 | image-cache index, through cached_network_image → flutter_cache_manager | none | yes: empty |
| path_provider_foundation 2.6.0 | finds the cache directory | none | no native sources: the package is Dart FFI only (`dartPluginClass`), so there is nothing to declare |

Dart-only packages (`http`, `cached_network_image`, `flutter_cache_manager`, `provider`, `intl`, `flutter_svg`) contain
no native iOS code. The app's only network destinations are the store API (`www.maytha.app`) and the
product-image host (Supabase storage). There are no analytics, ads, crash-reporting or attribution SDKs.

The Flutter engine (`Flutter.xcframework`) ships its own manifest (source
`engine/src/flutter/shell/platform/darwin/ios/framework/PrivacyInfo.xcprivacy` at tag 3.41.6): no tracking,
no collected data, FileTimestamp (`0A2A.1`, `C617.1`) and SystemBootTime (`35F9.1`).

### App-level manifest `ios/Runner/PrivacyInfo.xcprivacy`
Added to the Runner target's Copy Bundle Resources. It declares `NSPrivacyTracking = false`, no tracking domains,
no collected data types, and the required-reason APIs the app relies on:
- `NSPrivacyAccessedAPICategoryUserDefaults`, reason `CA92.1`: the app reads and writes its own settings only.
- `NSPrivacyAccessedAPICategoryFileTimestamp`, reason `C617.1`: timestamps of image-cache files inside the app container.

Sources: Apple, "Describing use of required reason API"
(https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) and
"Privacy manifest files" (https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).

### Why "Data Not Collected" (App Store) and "No data collected / shared" (Play) are accurate
- Apple defines "collect" as sending data off the device in a way that lets you or your partners access it for
  longer than needed to handle the request in real time
  (https://developer.apple.com/app-store/app-privacy-details/, "Data collection").
  The app sends only the language, product ids and quantities to get the catalog and prices. These are not
  user data types, they are not linked to a person or device id, and the app does not store them anywhere.
- Google Play does not count data that is processed ephemerally (held only in memory, and only to serve that
  request in real time) as collected
  (https://support.google.com/googleplay/android-developer/answer/10787469, "Ephemeral processing").
  Cart quotes and catalog reads fit this. Cart and favorites stay on the device, and Play does not count
  on-device data as collected.
- Caveat for the owner: the hosting provider (Vercel) keeps standard request logs (IP address, user agent)
  for a short time for operations and security. They are not used to identify users, for analytics or for
  advertising. If that changes (for example, adding analytics), update both declarations.

# Release checklist — MAYTHA MARKET 1.0.0 (build 1)

Items marked **[Owner]** need the store owner's accounts, money, devices or keys and cannot be done by a developer alone.

## 0. Before any release
- [ ] The store API endpoints (`/api/v1/catalog`, `/api/v1/products/<slug>`, `/api/v1/cart/quote`) are live in Production.
- [ ] `flutter analyze` clean and `flutter test` green in `mobile/maytha_market`.
- [ ] Manual smoke test on a real Android phone: browse, search in Arabic, product page, add to cart, totals, "Order via WhatsApp" opens WhatsApp with the right message, language switch, deep link `maytha://product/<slug>`.
- [x] Privacy policy: https://maithaloun-sooq.vercel.app/privacy (English: /en/privacy), with an app section. **[Owner]** reviews the text.
- [ ] Bump `version:` in `pubspec.yaml` for every upload (`1.0.0+1` → `1.0.1+2`...). The build number must always increase.

Build with a non-default API if needed:
`flutter build appbundle --release --dart-define=API_BASE_URL=https://<domain>`

## 1. Google Play (Android)
- [ ] **[Owner]** Create a Google Play Console developer account (one-time USD 25 fee, identity verification; a new personal account must run a **closed test with at least 12 testers opted in for 14 days in a row** before it can apply for production access).
- [ ] **[Owner]** Create the upload key once, on your own computer: from `mobile/maytha_market` run
      `powershell -ExecutionPolicy Bypass -File tool/create-upload-key.ps1`. You type the password; the key is saved
      outside the repository in `%USERPROFILE%/.maytha/maytha-upload.jks`, and the gitignored `android/key.properties`
      is written for you. It prints the SHA-256 fingerprint. **Back up the .jks file and the password.**
      Without the key a release build now stops with an error instead of producing a debug-signed bundle.
- [ ] Windows prerequisite: Android SDK **Command-line Tools (latest)** must be installed (Android Studio → Settings → Languages & Frameworks → Android SDK → SDK Tools). Without them Flutter cannot run its final check of the bundle and reports "failed to strip debug symbols" even though Gradle stripped them; `flutter doctor` then shows "cmdline-tools component is missing". Afterwards run `flutter doctor --android-licenses`.
- [ ] Build: `flutter build appbundle --release` → `build/app/outputs/bundle/release/app-release.aab`.
      Check the signer: `keytool -printcert -jarfile app-release.aab` must NOT say `CN=Android Debug`.
- [ ] **[Owner]** Create the app in Play Console (name MAYTHA MARKET, default language Arabic, App, Free).
- [ ] **[Owner]** Enrol in Play App Signing (default) and upload the first AAB to Internal testing.
- [ ] Store listing: text from `store/listing.md` (title ≤ 30, short description ≤ 80, full description ≤ 4000 characters; lengths are listed there), 512×512 32-bit icon `store/play/icon-512.png`, 1024×500 feature graphic `store/play/feature-graphic-1024x500.png` (24-bit PNG, no alpha), phone screenshots `store/screenshots/*.png` (1080×2340). Re-render the graphics with `node mobile/maytha_market/store/source/render-store-graphics.mjs`.
- [ ] App content: privacy policy URL, Data safety (see `store/privacy-and-permissions.md`), ads = No, content rating questionnaire, target audience (not children), news app = No.
- [ ] Countries: choose where to publish.
- [ ] Closed test → production review.

- [ ] **Verified App Links** (product links open the app instead of the browser). Two different certificates matter:
      - the **upload key** (yours, `CN=MAYTHA MARKET, O=MAYTHA MARKET, L=Maythaloun, C=PS`) signs what you upload;
      - the **app signing key** (Google's, created when Play App Signing is enabled) signs what users install.
      Android verifies links against the certificate of the installed app, so the **app signing** fingerprint is required;
      the upload fingerprint alone does not work for Play installs.
      1. Upload the first AAB with Play App Signing enabled (the default).
      2. Play Console → Test and release → App integrity → App signing: copy the **App signing key certificate** SHA-256,
         and the **Upload key certificate** SHA-256 (it must equal the one printed by `keytool -printcert -jarfile app-release.aab`).
      3. Vercel → Project → Settings → Environment Variables (Production): `ANDROID_APP_CERT_SHA256` =
         `<app signing SHA-256>,<upload SHA-256>` (the upload one lets locally installed release builds verify too). Redeploy.
         Do not set it before step 2: with the upload fingerprint only, Play installs will not verify.
      4. Check `https://maithaloun-sooq.vercel.app/.well-known/assetlinks.json` lists both (404 until set). The app already
         declares `android:autoVerify="true"` for `/products/*`, `/ar/products/*`, `/en/products/*`.
      5. On a phone with the Play build: `adb shell pm get-app-links market.maytha.app` shows `verified`.
      `maytha://product/<slug>` always opens the app.

## 2. Apple App Store (iOS)
iOS is built and tested in CI on every app change (`.github/workflows/mobile.yml`, GitHub macOS runner): simulator build, unsigned device build, unit tests and the live-API integration test on an iPhone simulator. Signing and upload still need the steps below.
- [ ] **[Owner]** Apple Developer Program membership (USD 99/year; organization enrollment needs a D-U-N-S number).
- [ ] **[Owner]** A Mac with current Xcode, and Flutter + CocoaPods installed.
- [ ] On the Mac: `cd mobile/maytha_market && flutter pub get && cd ios && pod install`.
- [ ] Open `ios/Runner.xcworkspace` in Xcode → Runner target → Signing & Capabilities → select the Team; bundle id `market.maytha.app` (register it in the developer portal if Xcode does not do it automatically).
- [ ] Check app icon (no alpha) and launch screen in the simulator; run on a real iPhone.
- [ ] Test deep link `maytha://product/<slug>` and WhatsApp ordering on the iPhone.
- [ ] **Universal Links**: in the developer portal enable **Associated Domains** for the App ID `market.maytha.app` (the app already requests `applinks:maithaloun-sooq.vercel.app`). In Vercel add `APPLE_TEAM_ID` = your 10-character Team ID and redeploy; `https://maithaloun-sooq.vercel.app/.well-known/apple-app-site-association` then lists `<TEAM_ID>.market.maytha.app` for product pages.
- [ ] `flutter build ipa --release` (or Xcode → Product → Archive) and upload with Xcode Organizer or Transporter.
- [ ] **[Owner]** App Store Connect: create the app (name, primary language Arabic, bundle id, SKU), category Shopping, privacy policy URL, App Privacy = Data Not Collected, age rating, screenshots: iPhone 6.9" set `store/app-store/*.png` (1320×2868, from the `store-screenshots` workflow artifact; the app is iPhone only, so no iPad set), name ≤ 30, subtitle ≤ 30, promotional text ≤ 170, description ≤ 4000 and keywords ≤ 100 characters from `store/listing.md`, support/marketing URL https://maithaloun-sooq.vercel.app, review contact details.
- [ ] TestFlight internal test, then submit for review. Explain in the review notes that ordering happens through WhatsApp and payment is cash on delivery (no in-app purchases of digital goods).

## 3. After release
- [ ] Keep the upload keystore and its passwords backed up in two safe places. Losing it requires a Play upload-key reset.
- [ ] Never commit `key.properties`, `*.jks` or `*.keystore` (already in `.gitignore`).

# Release checklist — MAYTHA MARKET 1.0.0 (build 1)

Items marked **[Owner]** need the store owner's accounts, money, devices or keys and cannot be done by a developer alone.

## 0. Before any release
- [ ] The store API endpoints (`/api/v1/catalog`, `/api/v1/products/<slug>`, `/api/v1/cart/quote`) are live in Production.
- [ ] `flutter analyze` clean and `flutter test` green in `mobile/maytha_market`.
- [ ] Manual smoke test on a real Android phone: browse, search in Arabic, product page, add to cart, totals, "Order via WhatsApp" opens WhatsApp with the right message, language switch, deep link `maytha://product/<slug>`.
- [ ] Publish a privacy policy page on the website and note its URL. **[Owner]** approves the text.
- [ ] Bump `version:` in `pubspec.yaml` for every upload (`1.0.0+1` → `1.0.1+2`...). The build number must always increase.

Build with a non-default API if needed:
`flutter build appbundle --release --dart-define=API_BASE_URL=https://<domain>`

## 1. Google Play (Android)
- [ ] **[Owner]** Create a Google Play Console developer account (one-time USD 25 fee, identity verification; a new personal account must run a closed test with testers for 14 days before production access).
- [ ] **[Owner]** Create the upload key on a trusted machine and keep it backed up outside the repo:
      `keytool -genkey -v -keystore %USERPROFILE%\maytha-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
- [ ] **[Owner]** Create `mobile/maytha_market/android/key.properties` (gitignored, never commit):
      ```
      storePassword=...
      keyPassword=...
      keyAlias=upload
      storeFile=C:\\Users\\<you>\\maytha-upload.jks
      ```
      Without this file the release build is signed with the **debug key** and Play will reject it.
- [ ] Build: `flutter build appbundle --release` → `build/app/outputs/bundle/release/app-release.aab`.
      Check the signer: `keytool -printcert -jarfile app-release.aab` must NOT say `CN=Android Debug`.
- [ ] **[Owner]** Create the app in Play Console (name MAYTHA MARKET, default language Arabic, App, Free).
- [ ] **[Owner]** Enrol in Play App Signing (default) and upload the first AAB to Internal testing.
- [ ] Store listing: text from `store/listing.md`, 512×512 icon (`assets/brand/icon-512.png`), 1024×500 feature graphic, phone screenshots.
- [ ] App content: privacy policy URL, Data safety (see `store/privacy-and-permissions.md`), ads = No, content rating questionnaire, target audience (not children), news app = No.
- [ ] Countries: choose where to publish.
- [ ] Closed test → production review.

Optional later: verified App Links for `https://<domain>/products/<slug>` need `/.well-known/assetlinks.json` on the website with the Play App Signing SHA-256. Not set up in this version (links open a chooser instead).

## 2. Apple App Store (iOS)
iOS cannot be built on Windows. The iOS project is generated in `ios/` but has **never been compiled**.
- [ ] **[Owner]** Apple Developer Program membership (USD 99/year; organization enrollment needs a D-U-N-S number).
- [ ] **[Owner]** A Mac with current Xcode, and Flutter + CocoaPods installed.
- [ ] On the Mac: `cd mobile/maytha_market && flutter pub get && cd ios && pod install`.
- [ ] Open `ios/Runner.xcworkspace` in Xcode → Runner target → Signing & Capabilities → select the Team; bundle id `market.maytha.app` (register it in the developer portal if Xcode does not do it automatically).
- [ ] Check app icon (no alpha) and launch screen in the simulator; run on a real iPhone.
- [ ] Test deep link `maytha://product/<slug>` and WhatsApp ordering on the iPhone.
- [ ] `flutter build ipa --release` (or Xcode → Product → Archive) and upload with Xcode Organizer or Transporter.
- [ ] **[Owner]** App Store Connect: create the app (name, primary language Arabic, bundle id, SKU), category Shopping, privacy policy URL, App Privacy = Data Not Collected, age rating, screenshots (6.7" and 6.5" iPhone at least), description from `store/listing.md`, support URL, review contact details.
- [ ] TestFlight internal test, then submit for review. Explain in the review notes that ordering happens through WhatsApp and payment is cash on delivery (no in-app purchases of digital goods).

## 3. After release
- [ ] Keep the upload keystore and its passwords backed up in two safe places. Losing it requires a Play upload-key reset.
- [ ] Never commit `key.properties`, `*.jks` or `*.keystore` (already in `.gitignore`).

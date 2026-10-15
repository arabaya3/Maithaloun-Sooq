# MAYTHA MARKET (Flutter)

Native Android/iOS app for the MAYTHA MARKET store. Arabic (RTL) by default, English optional.
Reads the public store API; orders are sent by the customer through WhatsApp (the app never creates orders).

```
flutter pub get
flutter run --dart-define=API_BASE_URL=https://maithaloun-sooq.vercel.app
flutter analyze && flutter test
flutter test integration_test -d <device>   # live API, read-only (catalog, product, quote); never creates orders
flutter build apk --debug
flutter build appbundle --release   # uses android/key.properties if present, else the debug key
```

Store and release material: `store/`.

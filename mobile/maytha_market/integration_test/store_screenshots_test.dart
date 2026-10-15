// Captures App Store screenshots of the real app against the LIVE public store API.
//
// Run (see .github/workflows/store-screenshots.yml):
//   SIM_UDID=<udid> flutter drive --driver=test_driver/screenshot_driver.dart \
//     --target=integration_test/store_screenshots_test.dart -d <udid>
// Read-only: catalog and product reads, plus the app's own cart quote. No order is created
// (nothing taps the WhatsApp button).
import 'dart:convert';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/config.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:shared_preferences/shared_preferences.dart';

const syncDir = String.fromEnvironment('SHOT_SYNC_DIR', defaultValue: '/tmp/maytha-shots');

Future<void> pumpUntil(WidgetTester tester, Finder finder,
    {Duration timeout = const Duration(seconds: 40)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $finder');
}

Future<void> idle(WidgetTester tester, [int seconds = 1]) async {
  for (var i = 0; i < seconds * 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Waits until the screen is final: no spinner, no snackbar and every visible network image
/// decoded (a CachedNetworkImage still loading shows its sage placeholder box).
Future<void> settleScreen(WidgetTester tester) async {
  ScaffoldMessenger.of(tester.element(find.byType(AppShell))).clearSnackBars();
  final loading = find.descendant(of: find.byType(CachedNetworkImage), matching: find.byType(ColoredBox));
  final end = DateTime.now().add(const Duration(seconds: 60));
  while (true) {
    await idle(tester);
    final busy = loading.evaluate().isNotEmpty ||
        find.byType(CircularProgressIndicator).evaluate().isNotEmpty ||
        find.byType(SnackBar).evaluate().isNotEmpty;
    if (!busy) break;
    if (DateTime.now().isAfter(end)) fail('Screen did not finish loading');
  }
  await idle(tester, 2); // image fade-in
}

/// Asks the host driver for a full-screen simulator screenshot and waits for it.
Future<void> shot(WidgetTester tester, String name) async {
  await settleScreen(tester);
  File('$syncDir/$name.req').writeAsStringSync(name);
  final done = File('$syncDir/$name.done');
  // The host may retry a stalled capture up to three times (40 s each).
  final end = DateTime.now().add(const Duration(seconds: 150));
  while (!done.existsSync()) {
    if (DateTime.now().isAfter(end)) fail('Host did not capture $name');
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(done.readAsStringSync(), '0', reason: 'simctl screenshot $name');
}

Future<void> addToCart(WidgetTester tester, String slug, String addText) async {
  openProduct(tester.element(find.byType(AppShell)), slug);
  await pumpUntil(tester, find.textContaining(addText));
  await idle(tester);
  await tester.tap(find.textContaining(addText).last);
  await idle(tester);
  Navigator.of(tester.element(find.textContaining(addText).last)).popUntil((r) => r.isFirst);
  await idle(tester);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('store screenshots', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();

    final res = await http.get(Uri.parse('${AppConfig.normalizedBaseUrl}/api/v1/catalog?locale=ar'));
    expect(res.statusCode, 200);
    final products = ((jsonDecode(utf8.decode(res.bodyBytes)) as Map)['products'] as List)
        .cast<Map>()
        .where((p) => p['available'] == true && p['image'] != null)
        .toList();
    // Product page: one with several options. Cart: the priciest item of three different
    // categories, so the cart is full and usually above the free-delivery threshold.
    final product = products.firstWhere((p) => (p['variants'] as List).length > 1, orElse: () => products.first);
    final slug = product['slug'] as String;
    final byCat = <String, Map>{};
    for (final p in [...products]..sort((a, b) => (b['priceAgorot'] as int).compareTo(a['priceAgorot'] as int))) {
      byCat.putIfAbsent(p['categoryCode'] as String, () => p);
    }
    final cartItems = byCat.values.take(3).toList();
    expect(cartItems, hasLength(3));

    await tester.pumpWidget(MaythaApp(prefs: prefs, api: HttpStoreApi(), enableDeepLinks: false));
    await pumpUntil(tester, find.byType(ProductCard));
    await shot(tester, '01-ar-home');

    await tester.tap(find.text('المتجر'));
    await shot(tester, '02-ar-catalog');

    openProduct(tester.element(find.byType(AppShell)), slug);
    await pumpUntil(tester, find.textContaining('أضف إلى السلة'));
    await shot(tester, '03-ar-product');
    Navigator.of(tester.element(find.textContaining('أضف إلى السلة').last)).pop();
    await idle(tester);

    for (final p in cartItems) {
      await addToCart(tester, p['slug'] as String, 'أضف إلى السلة');
    }
    await tester.tap(find.text('السلة').last);
    await pumpUntil(tester, find.text('الإجمالي'));
    await shot(tester, '04-ar-cart');

    await tester.tap(find.text('الإعدادات'));
    await idle(tester);
    await tester.tap(find.text('English'));
    await pumpUntil(tester, find.text('Home'));
    await tester.tap(find.text('Home'));
    await pumpUntil(tester, find.byType(ProductCard));
    await idle(tester, 5); // the English catalog reloads after the switch
    await shot(tester, '05-en-home');

    openProduct(tester.element(find.byType(AppShell)), slug);
    await pumpUntil(tester, find.textContaining('Add to cart'));
    await shot(tester, '06-en-product');
  });
}

// Visual QA on an Android emulator against the LIVE public store API.
//
// Run: flutter test integration_test/android_screenshots_test.dart -d <serial> \
//        --dart-define=SHOT_LOCALE=ar --dart-define=SHOT_PREFIX=pixel5-ar-1.0
// At each screen the test prints `SHOT:<name>` once the screen is fully
// loaded (no spinner, every visible image decoded) and holds still for
// [_hold] so the host can run `adb emu screenrecord screenshot`.
// Read-only: catalog/product reads and the app's own cart quote. Nothing taps
// the WhatsApp button; no order is created.
import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/config.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _locale = String.fromEnvironment('SHOT_LOCALE', defaultValue: 'ar');
const _prefix = String.fromEnvironment('SHOT_PREFIX', defaultValue: 'shot');
const _hold = Duration(seconds: 8);

Future<void> idle(WidgetTester tester, [int seconds = 1]) async {
  for (var i = 0; i < seconds * 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> pumpUntil(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 60)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $finder');
}

/// Waits until no spinner/snackbar is showing and every on-screen network
/// image has decoded (a loading CachedNetworkImage shows a ColoredBox).
Future<void> settle(WidgetTester tester) async {
  ScaffoldMessenger.of(tester.element(find.byType(AppShell, skipOffstage: false))).clearSnackBars();
  final loading = find.descendant(of: find.byType(CachedNetworkImage), matching: find.byType(ColoredBox)).hitTestable();
  final end = DateTime.now().add(const Duration(seconds: 90));
  while (true) {
    await idle(tester);
    final busy =
        loading.evaluate().isNotEmpty ||
        find.byType(CircularProgressIndicator).hitTestable().evaluate().isNotEmpty ||
        find
            .byType(LinearProgressIndicator)
            .hitTestable()
            .evaluate()
            .any((e) => (e.widget as LinearProgressIndicator).value == null) ||
        find.byType(SnackBar).evaluate().isNotEmpty;
    if (!busy) break;
    if (DateTime.now().isAfter(end)) fail('Screen did not finish loading');
  }
  await idle(tester, 2); // fade-in
}

Future<void> shot(WidgetTester tester, String name) async {
  await settle(tester);
  expect(tester.takeException(), isNull, reason: 'no layout errors on $name');
  // ignore: avoid_print
  print('SHOT:$_prefix-$name');
  final end = DateTime.now().add(_hold);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('android visual QA screenshots ($_locale)', (tester) async {
    SharedPreferences.setMockInitialValues({'locale.v1': _locale});
    final prefs = await SharedPreferences.getInstance();

    final res = await http.get(Uri.parse('${AppConfig.normalizedBaseUrl}/api/v1/catalog?locale=$_locale'));
    expect(res.statusCode, 200);
    final products = ((jsonDecode(utf8.decode(res.bodyBytes)) as Map)['products'] as List)
        .cast<Map>()
        .where((p) => p['available'] == true && p['image'] != null)
        .toList();
    final product = products.firstWhere((p) => (p['variants'] as List).length > 1, orElse: () => products.first);

    await tester.pumpWidget(MaythaApp(prefs: prefs, api: HttpStoreApi(), enableDeepLinks: false));
    // At large text the product grid may start below the fold; wait for any image.
    await pumpUntil(tester, find.byType(NetImage));
    await shot(tester, '1-home');

    final shell = tester.element(find.byType(AppShell, skipOffstage: false)).read<ShellController>();
    shell.go(1);
    await pumpUntil(tester, find.byType(ProductCard));
    await shot(tester, '2-listing');

    openProduct(tester.element(find.byType(AppShell, skipOffstage: false)), product['slug'] as String);
    await pumpUntil(tester, find.byKey(const ValueKey('add-to-cart')));
    await shot(tester, '3-product');
    await tester.tap(find.byKey(const ValueKey('add-to-cart')));
    await idle(tester, 2);
    Navigator.of(tester.element(find.byKey(const ValueKey('add-to-cart')))).popUntil((r) => r.isFirst);
    await idle(tester);

    // A second, cheaper item so the cart shows several lines.
    final other = products.firstWhere((p) => p['slug'] != product['slug']);
    openProduct(tester.element(find.byType(AppShell, skipOffstage: false)), other['slug'] as String);
    await pumpUntil(tester, find.byKey(const ValueKey('add-to-cart')));
    await idle(tester);
    await tester.tap(find.byKey(const ValueKey('add-to-cart')));
    await idle(tester, 2);
    Navigator.of(tester.element(find.byKey(const ValueKey('add-to-cart')))).popUntil((r) => r.isFirst);
    await idle(tester);

    shell.go(3);
    await pumpUntil(tester, find.byIcon(Icons.chat_outlined));
    final cart = tester.element(find.byType(AppShell, skipOffstage: false)).read<CartStore>();
    final end = DateTime.now().add(const Duration(seconds: 60));
    while (cart.quoteStatus != QuoteStatus.ready && DateTime.now().isBefore(end)) {
      await idle(tester);
    }
    expect(cart.quoteStatus, QuoteStatus.ready);
    await shot(tester, '4-cart');

    shell.go(4);
    await idle(tester);
    await shot(tester, '5-settings');
  });
}

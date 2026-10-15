// Captures App Store screenshots of the real app against the LIVE public store API.
//
// Run (see .github/workflows/store-screenshots.yml):
//   flutter drive --driver=test_driver/screenshot_driver.dart \
//     --target=integration_test/store_screenshots_test.dart -d <iPhone simulator>
// Read-only: catalog, product and cart quote only. No order is created (nothing taps WhatsApp).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/config.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> pumpUntil(WidgetTester tester, Finder finder,
    {Duration timeout = const Duration(seconds: 40)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $finder');
}

/// Pumps real time so network images finish loading before a screenshot.
Future<void> idle(WidgetTester tester, [int seconds = 4]) async {
  for (var i = 0; i < seconds * 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('store screenshots', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();

    final res = await http.get(Uri.parse('${AppConfig.normalizedBaseUrl}/api/v1/catalog?locale=ar'));
    expect(res.statusCode, 200);
    final products = ((jsonDecode(utf8.decode(res.bodyBytes)) as Map)['products'] as List).cast<Map>();
    // A product with an image and several options makes the most informative product page.
    final product = products.firstWhere(
      (p) => p['available'] == true && (p['variants'] as List).length > 1,
      orElse: () => products.firstWhere((p) => p['available'] == true),
    );
    final slug = product['slug'] as String;

    await tester.pumpWidget(MaythaApp(prefs: prefs, api: HttpStoreApi(), enableDeepLinks: false));
    await pumpUntil(tester, find.byType(ProductCard));
    await idle(tester);
    await binding.takeScreenshot('01-ar-home');

    await tester.tap(find.text('المتجر'));
    await idle(tester);
    await binding.takeScreenshot('02-ar-catalog');

    openProduct(tester.element(find.byType(AppShell)), slug);
    await pumpUntil(tester, find.textContaining('أضف إلى السلة'));
    await idle(tester);
    await binding.takeScreenshot('03-ar-product');

    await tester.tap(find.textContaining('أضف إلى السلة').last);
    await idle(tester, 1);
    await tester.tap(find.text('عرض السلة'));
    await pumpUntil(tester, find.text('الإجمالي'));
    await idle(tester);
    await binding.takeScreenshot('04-ar-cart');

    await tester.tap(find.text('الإعدادات'));
    await idle(tester, 1);
    await tester.tap(find.text('English'));
    await pumpUntil(tester, find.text('Home'));
    await tester.tap(find.text('Home'));
    await pumpUntil(tester, find.byType(ProductCard));
    await idle(tester, 6);
    await binding.takeScreenshot('05-en-home');

    openProduct(tester.element(find.byType(AppShell)), slug);
    await pumpUntil(tester, find.textContaining('Add to cart'));
    await idle(tester);
    await binding.takeScreenshot('06-en-product');
  });
}

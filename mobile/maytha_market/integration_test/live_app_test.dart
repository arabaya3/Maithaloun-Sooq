// End-to-end tests of the real app against the LIVE public store API.
//
// Run on a device/emulator:  flutter test integration_test -d <device>
// Only read-only endpoints are used (catalog, product, cart quote). No order is
// ever created: the WhatsApp launch is captured by a fake url_launcher platform.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/config.dart';
import 'package:maytha_market/core/money.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

class FakeLauncher extends Fake with MockPlatformInterfaceMixin implements UrlLauncherPlatform {
  final launched = <String>[];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    return true;
  }

  @override
  Future<bool> launch(String url,
      {required bool useSafariVC,
      required bool useWebView,
      required bool enableJavaScript,
      required bool enableDomStorage,
      required bool universalLinksOnly,
      required Map<String, String> headers,
      String? webOnlyWindowName}) async {
    launched.add(url);
    return true;
  }

  @override
  Future<bool> supportsMode(PreferredLaunchMode mode) async => true;

  @override
  Future<bool> supportsCloseForMode(PreferredLaunchMode mode) async => false;
}

final base = AppConfig.normalizedBaseUrl;

Future<Map<String, dynamic>> getJson(String path) async {
  final res = await http.get(Uri.parse('$base$path'));
  expect(res.statusCode, 200, reason: path);
  return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
}

/// Pumps frames until [finder] matches or [timeout] passes (network-friendly pumpAndSettle).
Future<void> pumpUntil(WidgetTester tester, Finder finder,
    {Duration timeout = const Duration(seconds: 40)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $finder');
}

/// Scrolls the product page until [f] is fully visible above the bottom bar, then taps it.
Future<void> scrollTap(WidgetTester tester, Finder f) async {
  final vertical = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down);
  await tester.scrollUntilVisible(f, 150, scrollable: vertical.last);
  await tester.drag(vertical.last, const Offset(0, -150), warnIfMissed: false);
  await settle(tester);
  await tester.tap(f);
  await settle(tester);
}

Future<void> settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late FakeLauncher launcher;
  late SharedPreferences prefs;

  setUp(() async {
    launcher = FakeLauncher();
    UrlLauncherPlatform.instance = launcher;
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  });

  Future<void> startApp(WidgetTester tester) async {
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: HttpStoreApi(), enableDeepLinks: false));
    await pumpUntil(tester, find.byType(ProductCard));
  }

  testWidgets('live catalog: search, category filter, sort, product, cart quote and WhatsApp order',
      (tester) async {
    final catalog = await getJson('/api/v1/catalog?locale=ar');
    final products = (catalog['products'] as List).cast<Map<String, dynamic>>();
    expect(products, isNotEmpty);
    expect(catalog['store']['whatsAppE164'], '+972599105456');

    await startApp(tester);
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.rtl);
    expect(find.text('المنتجات'), findsOneWidget);

    // --- Shop: Arabic-normalized search. Pick a real product whose name has a hamza-alef
    // (أ/إ/آ) and search for that word written with a bare alef.
    final hamzaWord = RegExp(r'[أإآ]\S{2,}');
    final target = products.firstWhere((p) => hamzaWord.hasMatch(p['name'] as String));
    final word = hamzaWord.firstMatch(target['name'] as String)!.group(0)!;
    final plain = word.replaceAll(RegExp('[أإآ]'), 'ا');
    expect(plain, isNot(word));

    await tester.tap(find.text('المتجر'));
    await settle(tester);
    await tester.enterText(find.byType(TextField), plain);
    await settle(tester);
    final shown = tester.widgetList<ProductCard>(find.byType(ProductCard)).map((c) => c.product.slug).toList();
    expect(shown, contains(target['slug']));
    expect(shown.length, lessThan(products.length));

    // No match -> empty state.
    await tester.enterText(find.byType(TextField), 'zzzz-no-such-product');
    await settle(tester);
    expect(find.text('لا توجد منتجات مطابقة لبحثك.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '');
    await settle(tester);

    // --- Category filter + sort by price (low to high).
    final cats = (catalog['categories'] as List).cast<Map<String, dynamic>>();
    final cat = cats.firstWhere((c) => products.where((p) => p['categoryCode'] == c['code']).length > 1);
    await tester.tap(find.widgetWithText(ChoiceChip, cat['name'] as String));
    await settle(tester);
    var cards = tester.widgetList<ProductCard>(find.byType(ProductCard)).toList();
    expect(cards, isNotEmpty);
    expect(cards.every((c) => c.product.categoryCode == cat['code']), isTrue);

    await tester.tap(find.byTooltip('الترتيب'));
    await settle(tester);
    await tester.tap(find.text('السعر: من الأقل للأعلى').last);
    await settle(tester);
    cards = tester.widgetList<ProductCard>(find.byType(ProductCard)).toList();
    final prices = cards.map((c) => c.product.priceAgorot).toList();
    expect(prices, orderedEquals([...prices]..sort()));
    await tester.tap(find.widgetWithText(ChoiceChip, 'الكل'));
    await settle(tester);

    // --- Open a product with several variants (prefer differing prices) and pick a non-default one.
    Map<String, dynamic> pick() {
      final multi = products.where((p) => p['available'] == true && (p['variants'] as List).length > 1).toList();
      for (final p in multi) {
        final prices = (p['variants'] as List).map((v) => (v['sellingUnits'] as List).first['priceAgorot']).toSet();
        if (prices.length > 1) return p;
      }
      return multi.first;
    }

    final prod = pick();
    final variants = (prod['variants'] as List).cast<Map<String, dynamic>>();
    final variant = variants.firstWhere((v) => v['id'] != prod['defaultVariantId'] && v['available'] == true);
    final units = (variant['sellingUnits'] as List).cast<Map<String, dynamic>>();
    final unit = units.length > 1
        ? units.firstWhere((u) => u['isDefault'] != true)
        : units.first;

    await tester.enterText(find.byType(TextField), (prod['name'] as String).split(' ').take(3).join(' '));
    await settle(tester);
    final card = find.byWidgetPredicate((w) => w is ProductCard && w.product.slug == prod['slug']);
    expect(card, findsOneWidget);
    await tester.tap(card);
    await pumpUntil(tester, find.widgetWithText(ChoiceChip, variant['label'] as String));
    await scrollTap(tester, find.widgetWithText(ChoiceChip, variant['label'] as String));
    await settle(tester);
    if (units.length > 1) {
      await scrollTap(tester, find.widgetWithText(ChoiceChip, '${unit['label']} · ${formatAgorot(unit['priceAgorot'] as int)}'));
      await settle(tester);
    }
    final qty = (unit['maxQuantity'] as int) >= 2 ? 2 : 1;
    if (qty == 2) {
      await scrollTap(tester, find.byTooltip('زيادة الكمية').first);
      await settle(tester);
    }
    final addLabel = 'أضف إلى السلة · ${formatAgorot((unit['priceAgorot'] as int) * qty)}';
    expect(find.text(addLabel), findsOneWidget);
    await tester.tap(find.text(addLabel));
    await settle(tester);

    // Back to the shell and open the cart.
    expect(find.text('تمت الإضافة إلى السلة'), findsOneWidget);
    await tester.tap(find.text('عرض السلة'));
    await pumpUntil(tester, find.text('الإجمالي'));

    // Independent live quote for the same items.
    final quoteRes = await http.post(
      Uri.parse('$base/api/v1/cart/quote?locale=ar'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'items': [
          {
            'productId': prod['id'],
            'variantId': variant['id'],
            'sellingUnitId': unit['id'],
            'unitsPerSale': unit['unitsPerSale'],
            'quantity': qty,
          }
        ]
      }),
    );
    final quote = (jsonDecode(utf8.decode(quoteRes.bodyBytes)) as Map)['quote'] as Map;
    final subtotal = formatAgorot(quote['itemsSubtotalAgorot'] as int);
    final fee = quote['deliveryFeeAgorot'] as int;
    final total = formatAgorot(quote['totalAgorot'] as int);
    expect(find.text(subtotal), findsWidgets);
    expect(find.text(fee == 0 ? 'مجاني' : formatAgorot(fee)), findsWidgets);
    expect(find.text(total), findsWidgets);

    // No name / phone (or any text) input in the cart before ordering.
    expect(find.byType(TextField), findsNothing);
    expect(find.byType(TextFormField), findsNothing);

    await tester.tap(find.text('اطلب عبر واتساب'));
    final end = DateTime.now().add(const Duration(seconds: 30));
    while (launcher.launched.isEmpty && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(launcher.launched, hasLength(1));
    final url = launcher.launched.single;
    // ignore: avoid_print
    print('WHATSAPP_URL=$url');
    expect(url, startsWith('https://wa.me/972599105456?text='));
    final text = Uri.parse(url).queryParameters['text']!;
    final line = (quote['lines'] as List).single as Map;
    expect(text, contains(line['name'] as String));
    expect(text, contains('الكمية: $qty'));
    expect(text, contains('السعر: ${formatAgorot(line['lineSubtotalAgorot'] as int)}'));
    expect(text, contains('المجموع: $subtotal'));
    expect(text, contains('التوصيل: ${formatAgorot(fee)}'));
    expect(text, contains('الإجمالي: $total'));
    if (line['options'] != null) expect(text, contains(line['options'] as String));
  });

  testWidgets('English switch gives LTR and English strings; Arabic back to RTL', (tester) async {
    await startApp(tester);
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.rtl);

    await tester.tap(find.text('الإعدادات'));
    await settle(tester);
    await tester.tap(find.text('English'));
    await pumpUntil(tester, find.text('Home'));
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.ltr);
    await tester.tap(find.text('Home'));
    await pumpUntil(tester, find.byType(ProductCard));
    expect(find.text('Products'), findsOneWidget);
    expect(find.text('Shop'), findsOneWidget);

    // Categories come from the live English catalog, which reloads after the switch: wait for it,
    // because the Arabic product cards are already on screen.
    final en = await getJson('/api/v1/catalog?locale=en');
    final firstCat = ((en['categories'] as List).first as Map)['name'] as String;
    await pumpUntil(tester, find.text(firstCat));
    expect(find.text(firstCat), findsWidgets);

    await tester.tap(find.text('Settings'));
    await settle(tester);
    await tester.tap(find.text('العربية'));
    await pumpUntil(tester, find.text('الرئيسية'));
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.rtl);
  });

  testWidgets('a product opened by slug loads from the live API', (tester) async {
    final catalog = await getJson('/api/v1/catalog?locale=ar');
    final p = (catalog['products'] as List).first as Map;
    await startApp(tester);
    openProduct(tester.element(find.byType(AppShell)), p['slug'] as String);
    await pumpUntil(tester, find.textContaining('أضف إلى السلة'));
    expect(find.text(p['name'] as String), findsWidgets);
  });
}

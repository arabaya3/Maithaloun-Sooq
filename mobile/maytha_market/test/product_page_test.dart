import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/title_split.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/ui/screens/product_screen.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';

const _loyalName = 'منعّم ومعطّر الملابس لويال بعدة روائح – 750 مل';

Map<String, dynamic> _variant(String id, String label, int price, {bool available = true, int max = 4}) => {
  'id': id,
  'label': label,
  'attributes': {'الرائحة': label},
  'available': available,
  'image': {'src': '/products/$id.webp', 'alt': id},
  'offer': null,
  'sellingUnits': [
    {
      'id': 'u-$id',
      'label': 'حبة واحدة',
      'unitsPerSale': 1,
      'priceAgorot': price,
      'isDefault': true,
      'maxQuantity': max,
    },
    if (id == 'pink')
      {
        'id': 'u-pink-3',
        'label': '3 حبات',
        'unitsPerSale': 3,
        'priceAgorot': 2700,
        'isDefault': false,
        'maxQuantity': 2,
      },
  ],
};

Map<String, dynamic> _loyalJson() => {
  'id': 'loyal',
  'slug': 'loyal-softener',
  'name': _loyalName,
  'nameAr': _loyalName,
  'brand': 'LOYAL',
  'categoryCode': 'cleaning',
  'available': true,
  'priceAgorot': 1000,
  'image': {'src': '/products/pink.webp', 'alt': 'pink'},
  'description': 'يمنح الملابس نعومة مميزة وعطراً زهرياً غنياً. ' * 6,
  'usageNotes': 'يضاف إلى درج المنعم.',
  'defaultVariantId': 'pink',
  'variants': [
    _variant('pink', 'لويال برائحة سوفت بينك (Soft Pink)', 1000),
    _variant('purple', 'لويال برائحة باشن البنفسجية (Purple Passion)', 1200),
    _variant('green', 'لويال برائحة الوادي الأخضر (Green Valley)', 1000, available: false),
  ],
};

class _Api extends FakeStoreApi {
  @override
  Future<Catalog> fetchCatalog(String locale) async {
    final j = catalogJson(locale: locale);
    (j['products'] as List).add(_loyalJson());
    return Catalog.fromJson(j);
  }

  @override
  Future<Product> fetchProduct(String slug, String locale) async {
    final p = (await fetchCatalog(locale)).bySlug(slug);
    if (p == null) throw ApiException('not found', statusCode: 404);
    return p;
  }
}

void main() {
  group('splitProductTitle', () {
    test('reproduces the mockup for the Loyal softener', () {
      final t = splitProductTitle(_loyalName);
      expect(t.title, 'منعّم ومعطّر الملابس لويال');
      expect(t.subtitle, 'بعدة روائح – 750 مل');
    });
    test('short head: split at the last dash only', () {
      final t = splitProductTitle('ملح غسالة الصحون فينيش الأصلي – وزن 2 كغم.');
      expect(t.title, 'ملح غسالة الصحون فينيش الأصلي');
      expect(t.subtitle, 'وزن 2 كغم.');
    });
    test('no dash, or dash inside parentheses: whole name is the title', () {
      expect(splitProductTitle('معطر البركان متعدد الاستعمالات').subtitle, isNull);
      final p = splitProductTitle('ملمع الأثاث لويال (LOYAL Furniture Polish – Wood & Leather).');
      expect(p.subtitle, isNull);
      expect(p.title, 'ملمع الأثاث لويال (LOYAL Furniture Polish – Wood & Leather).');
    });
    test('English hyphen', () {
      final t = splitProductTitle('Fairy Lemon - 500 ml');
      expect((t.title, t.subtitle), ('Fairy Lemon', '500 ml'));
    });
    test('option labels drop shared leading words only', () {
      expect(shortOptionLabels(['لويال برائحة أ', 'لويال برائحة ب']), ['أ', 'ب']);
      expect(shortOptionLabels(['لويال أ', 'لويال']), ['لويال أ', 'لويال']);
      expect(shortOptionLabels(['45 قرص', '72 قرص']), ['45 قرص', '72 قرص']);
    });
  });

  late SharedPreferences prefs;

  Future<BuildContext> open(WidgetTester tester, {String locale = 'ar', double scale = 1.0}) async {
    SharedPreferences.setMockInitialValues({'locale.v1': locale});
    prefs = await SharedPreferences.getInstance();
    tester.view.physicalSize = const Size(360 * 3, 640 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: _Api(), enableDeepLinks: false));
    await tester.pumpAndSettle();
    final ctx = tester.element(find.byType(AppShell));
    openProduct(ctx, 'loyal-softener');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    return ctx;
  }

  String priceText(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('product-price'))).data!;

  for (final locale in ['ar', 'en']) {
    for (final scale in [1.0, 1.5, 2.0]) {
      testWidgets('layout $locale at 360x640, text scale $scale: no overflow, key parts visible', (tester) async {
        await open(tester, locale: locale, scale: scale);
        const screen = Rect.fromLTWH(0, 0, 360, 640);
        // Price fully on screen (never clipped) and beside/near the title.
        final price = tester.getRect(find.byKey(const ValueKey('product-price')));
        expect(screen.contains(price.topLeft) && screen.contains(price.bottomRight), isTrue);
        final add = tester.getRect(find.byKey(const ValueKey('add-to-cart')));
        expect(add.bottom, lessThanOrEqualTo(640));
        expect(add.height, greaterThanOrEqualTo(48));
        expect(tester.getSize(find.byKey(const ValueKey('product-back'))), const Size(48, 48));
        // Chips, stepper and description reachable by scrolling, without overflow.
        for (final key in ['variant-green', 'unit-u-pink-3', 'description-toggle']) {
          await tester.ensureVisible(find.byKey(ValueKey(key)));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: key);
        }
        await tester.ensureVisible(find.byType(QuantityStepper));
        await tester.pumpAndSettle();
        expect(find.byType(QuantityStepper).hitTestable(), findsOneWidget);
        await tester.drag(find.byType(Scrollable).hitTestable().first, const Offset(0, -3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('Arabic labels: brand, option name from data, title/subtitle; English option label', (tester) async {
    await open(tester);
    expect(find.text('LOYAL'), findsOneWidget);
    expect(find.text('اختر الرائحة'), findsOneWidget);
    expect(find.text('منعّم ومعطّر الملابس لويال'), findsOneWidget);
    expect(find.text('بعدة روائح – 750 مل'), findsOneWidget);
    // Chip labels drop the shared brand word.
    expect(find.text('سوفت بينك (Soft Pink)'), findsOneWidget);
    expect(find.bySemanticsLabel('لويال برائحة سوفت بينك (Soft Pink)'), findsOneWidget);
    expect(priceText(tester), '10 ₪');
    expect(find.textContaining('أضف إلى السلة · 10 ₪'), findsOneWidget);
  });

  testWidgets('English: option label translated', (tester) async {
    await open(tester, locale: 'en');
    expect(find.text('Choose scent'), findsOneWidget);
    expect(find.textContaining('Add to cart · 10 ₪'), findsOneWidget);
  });

  testWidgets('variant chip updates price, image and session; unavailable chip is not selectable', (tester) async {
    final ctx = await open(tester);
    final pager = tester.widget<PageView>(find.byType(PageView)).controller!;
    expect(pager.page, 0);
    await tester.tap(find.byKey(const ValueKey('variant-purple')));
    await tester.pumpAndSettle();
    expect(priceText(tester), '12 ₪');
    expect(pager.page, 1);
    expect(ctx.read<ShellController>().variantId, 'purple');
    // Pink-only multipack chips disappear for purple.
    expect(find.byKey(const ValueKey('unit-u-pink-3')), findsNothing);

    await tester.ensureVisible(find.byKey(const ValueKey('variant-green')));
    await tester.tap(find.byKey(const ValueKey('variant-green')), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(priceText(tester), '12 ₪');
    expect(ctx.read<ShellController>().variantId, 'purple');
  });

  testWidgets('selling unit chip updates price and button total; stepper limits', (tester) async {
    await open(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('unit-u-pink-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('unit-u-pink-3')));
    await tester.pumpAndSettle();
    expect(priceText(tester), '27 ₪');
    final inc = find.byTooltip('زيادة الكمية');
    final incFinder = inc.evaluate().isEmpty ? find.byIcon(Icons.add) : inc;
    await tester.ensureVisible(incFinder);
    for (var i = 0; i < 4; i++) {
      await tester.tap(incFinder, warnIfMissed: false);
      await tester.pump();
    }
    // Max 2 packs.
    expect(find.descendant(of: find.byType(QuantityStepper), matching: find.text('2')), findsOneWidget);
    expect(find.textContaining('54 ₪'), findsOneWidget);
  });

  testWidgets('single add on double tap; snackbar does not cover the button', (tester) async {
    final ctx = await open(tester);
    await tester.tap(find.byKey(const ValueKey('add-to-cart')));
    await tester.tap(find.byKey(const ValueKey('add-to-cart')), warnIfMissed: false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final cart = ctx.read<CartStore>();
    expect(cart.lines.single.quantity, 1);
    expect(cart.lines.single.variantId, 'pink');
    final snack = tester.getRect(find.descendant(of: find.byType(SnackBar), matching: find.byType(Material)).first);
    final add = tester.getRect(find.byKey(const ValueKey('add-to-cart')));
    expect(snack.bottom, lessThanOrEqualTo(add.top));
    await tester.pumpAndSettle(const Duration(seconds: 4));
  });

  testWidgets('description collapses to 3 lines and expands with usage notes', (tester) async {
    await open(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('description-toggle')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('description-body'))).maxLines, 3);
    expect(find.text('يضاف إلى درج المنعم.'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('description-toggle')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('description-body'))).maxLines, isNull);
    expect(find.text('يضاف إلى درج المنعم.'), findsOneWidget);
  });

  testWidgets('back button pops the product page', (tester) async {
    await open(tester);
    await tester.tap(find.byKey(const ValueKey('product-back')));
    await tester.pumpAndSettle();
    expect(find.byType(ProductScreen), findsNothing);
  });
}

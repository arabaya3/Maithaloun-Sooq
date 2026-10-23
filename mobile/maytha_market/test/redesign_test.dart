import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/state/session.dart';
import 'package:maytha_market/state/stores.dart';
import 'package:maytha_market/ui/screens/product_screen.dart';
import 'package:maytha_market/ui/screens/settings_screen.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';
import 'widget_test.dart' show harness;

const _longName = 'أقراص غسالة الصحون فينيش كوانتوم باوربول برائحة الليمون – 45 او 72 قرص';

Map<String, dynamic> _finishJson() => {
  'id': 'p9',
  'slug': 'finish-quantum',
  'name': _longName,
  'nameAr': _longName,
  'brand': 'Finish',
  'categoryCode': 'cleaning',
  'available': true,
  'priceAgorot': 3200,
  'image': {'src': '/products/finish.webp', 'alt': 'Finish', 'width': 800, 'height': 800},
  'description': List.filled(12, 'أقراص فينيش كوانتوم لغسالات الصحون بتركيبة قوية.').join(' '),
  'usageNotes': null,
  'defaultVariantId': 'v45',
  'variants': [
    for (final (id, label, price) in [('v45', '45 قرص', 3200), ('v72', '72 قرص', 4800)])
      {
        'id': id,
        'label': label,
        'attributes': {'count': label},
        'available': true,
        'image': null,
        'offer': null,
        'sellingUnits': [
          {'id': 'u-$id', 'label': 'حبة', 'unitsPerSale': 1, 'priceAgorot': price, 'isDefault': true, 'maxQuantity': 3},
        ],
      },
  ],
};

Map<String, dynamic> _catalogWithFinish({String locale = 'ar'}) {
  final j = catalogJson(locale: locale);
  (j['products'] as List).add(_finishJson());
  return j;
}

class _Api extends FakeStoreApi {
  int catalogCalls = 0;
  bool offline = false;
  @override
  Future<Catalog> fetchCatalog(String locale) async {
    catalogCalls++;
    if (offline) throw ApiException('offline');
    return Catalog.fromJson(_catalogWithFinish(locale: locale));
  }

  @override
  Future<Product> fetchProduct(String slug, String locale) async {
    final p = Catalog.fromJson(_catalogWithFinish(locale: locale)).bySlug(slug);
    if (p == null) throw ApiException('not found', statusCode: 404);
    return p;
  }
}

class _NetworkFailProductApi extends _Api {
  @override
  Future<Product> fetchProduct(String slug, String locale) async => throw ApiException('timeout');
}

void main() {
  late SharedPreferences prefs;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
  });

  Future<void> phone(WidgetTester tester, {double width = 360, double height = 740}) async {
    tester.view.physicalSize = Size(width * 3, height * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  for (final scale in [1.0, 1.5]) {
    testWidgets('product grid at 360dp, text scale $scale: no overflow, every price visible', (tester) async {
      await phone(tester);
      final catalog = Catalog.fromJson(_catalogWithFinish());
      await tester.pumpWidget(
        ChangeNotifierProvider(
          create: (_) => FavoritesStore(prefs),
          child: harness(
            Builder(
              builder: (context) => MediaQuery(
                data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
                child: Scaffold(
                  body: CustomScrollView(
                    slivers: [ProductSliverGrid(products: catalog.products, onOpen: (_) {})],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      final cards = find.byType(ProductCard);
      expect(cards, findsNWidgets(3));
      for (var i = 0; i < 3; i++) {
        final card = tester.getRect(cards.at(i));
        final price = tester.getRect(
          find.descendant(of: cards.at(i), matching: find.byKey(const ValueKey('product-card-price'))),
        );
        expect(
          card.contains(price.topLeft) && card.contains(price.bottomRight - const Offset(0.01, 0.01)),
          isTrue,
          reason: 'price of card $i must be fully inside the card',
        );
        expect(price.height, greaterThan(10));
      }
      // Long titles are capped at two lines.
      final title = tester.widget<Text>(find.text(_longName));
      expect(title.maxLines, 2);
    });
  }

  testWidgets('product details at text scale 2.0 (360dp): title capped, sticky add-to-cart, variant price', (
    tester,
  ) async {
    await phone(tester);
    tester.platformDispatcher.textScaleFactorTestValue = 2.0; // within kMaxTextScale
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final api = _Api();
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final nav = tester.state<NavigatorState>(find.byType(Navigator).first);
    nav.push(MaterialPageRoute(builder: (_) => const ProductScreen(slug: 'finish-quantum')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    final title = tester.widget<Text>(find.byKey(const ValueKey('product-title')));
    expect(title.maxLines, 3);
    // The title is shown once (not duplicated in the app bar).
    expect(find.text(_longName), findsOneWidget);
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    final button = tester.getRect(find.byKey(const ValueKey('add-to-cart')));
    expect(button.bottom, lessThanOrEqualTo(screen.height));
    expect(find.textContaining('32 ₪'), findsWidgets);

    await tester.ensureVisible(find.byKey(const ValueKey('variant-v72')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('variant-v72')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('product-price')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('product-price'))).data, '48 ₪');
    expect(context(tester).read<ShellController>().variantId, 'v72');

    await tester.tap(find.byKey(const ValueKey('add-to-cart')));
    await tester.tap(find.byKey(const ValueKey('add-to-cart'))); // double tap is ignored
    await tester.pump();
    final cart = context(tester).read<CartStore>();
    expect(cart.lines.single.variantId, 'v72');
    expect(cart.lines.single.quantity, 1);
    await tester.pumpAndSettle(const Duration(seconds: 4));
    expect(api.quoteCalls, 0);
  });

  testWidgets('settings: grouped sections, policies open in a sheet with existing texts', (tester) async {
    await phone(tester);
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: _Api(), enableDeepLinks: false));
    await tester.pumpAndSettle();
    await tester.tap(find.text('الإعدادات'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final s in ['التفضيلات', 'معلومات التسوق', 'الدعم']) {
      expect(find.text(s), findsOneWidget);
    }
    await tester.ensureVisible(find.text('الخصوصية'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('الخصوصية'));
    await tester.pumpAndSettle();
    expect(find.textContaining('لا حاجة لإنشاء حساب'), findsOneWidget);
    expect(find.text('عرض الصفحة الكاملة على الموقع'), findsOneWidget);
    expect(policyUri('privacy', 'ar').toString(), 'https://maithaloun-sooq.vercel.app/privacy');
    expect(policyUri('terms', 'en').toString(), 'https://maithaloun-sooq.vercel.app/en/terms');
  });

  group('session restoration', () {
    void seed(Duration age, {String? slug, String? variant, int tab = 0, String query = ''}) {
      SharedPreferences.setMockInitialValues({
        SessionStore.key: jsonEncode(
          SessionSnapshot(
            tab: tab,
            productSlug: slug,
            variantId: variant,
            query: query,
            category: 'cleaning',
            sort: 'priceLow',
            savedAt: DateTime.now().subtract(age),
          ).toJson(),
        ),
      });
    }

    test('window is at least ten minutes', () {
      expect(SessionStore.restoreWindow, greaterThanOrEqualTo(const Duration(minutes: 10)));
    });

    testWidgets('within the window: restores product + variant on top of the saved tab', (tester) async {
      seed(const Duration(minutes: 9), slug: 'finish-quantum', variant: 'v72', tab: 1, query: 'فينيش');
      prefs = await SharedPreferences.getInstance();
      final api = _Api();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('product-price'))).data, '48 ₪');
      final shell = context(tester).read<ShellController>();
      expect(shell.index, 1);
      expect(shell.productSlug, 'finish-quantum');
      expect(shell.variantId, 'v72');
      // Nothing was submitted: no quote, cart untouched.
      expect(api.quoteCalls, 0);
      expect(context(tester).read<CartStore>().lines, isEmpty);
      // Back returns to the restored catalog tab with its search.
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsNothing);
      expect(find.widgetWithText(TextField, 'فينيش'), findsOneWidget);
    });

    testWidgets('within the window: restores catalog search, category and sort', (tester) async {
      seed(const Duration(minutes: 3), tab: 1, query: 'فيري');
      prefs = await SharedPreferences.getInstance();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: _Api(), enableDeepLinks: false));
      await tester.pumpAndSettle();
      final shell = context(tester).read<ShellController>();
      expect(shell.index, 1);
      expect(shell.catalogSort, 'priceLow');
      expect(shell.catalogCategory, 'cleaning');
      expect(find.widgetWithText(TextField, 'فيري'), findsOneWidget);
    });

    testWidgets('expired: starts at home and clears the snapshot', (tester) async {
      seed(const Duration(minutes: 11), slug: 'finish-quantum', tab: 1);
      prefs = await SharedPreferences.getInstance();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: _Api(), enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsNothing);
      expect(context(tester).read<ShellController>().index, 0);
      final saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key) ?? 'null'));
      expect(saved?.productSlug, isNull);
    });

    testWidgets('missing product: falls back to home with a gentle message', (tester) async {
      seed(const Duration(minutes: 2), slug: 'deleted-product', tab: 2);
      prefs = await SharedPreferences.getInstance();
      final api = _Api();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsNothing);
      expect(context(tester).read<ShellController>().index, 0);
      expect(find.text('المنتج الذي كنت تشاهده لم يعد متاحاً.'), findsOneWidget);
      expect(api.quoteCalls, 0);
      final saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.productSlug, isNull, reason: 'a genuinely missing product is dropped from the snapshot');
    });

    testWidgets('network failure during restore: no "deleted" message, snapshot kept, retry restores', (tester) async {
      seed(const Duration(minutes: 2), slug: 'finish-quantum', variant: 'v72');
      prefs = await SharedPreferences.getInstance();
      final api = _Api()..offline = true;
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsNothing);
      expect(find.text('المنتج الذي كنت تشاهده لم يعد متاحاً.'), findsNothing);
      expect(find.text('تعذّر تحميل المتجر. تحقق من الاتصال وحاول مرة أخرى.'), findsOneWidget);
      // The snapshot (product + variant) survives the failure and any tab move.
      context(tester).read<ShellController>().go(1);
      await tester.pumpAndSettle();
      var saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.productSlug, 'finish-quantum');
      expect(saved.variantId, 'v72');
      context(tester).read<ShellController>().go(0);
      await tester.pumpAndSettle();

      api.offline = false;
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.byType(ProductScreen), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('product-price'))).data, '48 ₪');
      expect(find.text('المنتج الذي كنت تشاهده لم يعد متاحاً.'), findsNothing);
      saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.productSlug, 'finish-quantum');
      expect(api.quoteCalls, 0);
    });

    testWidgets('product screen: network error is not reported as "not found"', (tester) async {
      prefs = await SharedPreferences.getInstance();
      final api = _NetworkFailProductApi();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      openProduct(tester.element(find.byType(AppShell, skipOffstage: false)), 'not-in-catalog');
      await tester.pumpAndSettle();
      expect(find.text('المنتج غير موجود.'), findsNothing);
      expect(find.text('تعذّر تحميل المتجر. تحقق من الاتصال وحاول مرة أخرى.'), findsOneWidget);
    });

    testWidgets('navigation is persisted as the user moves; cart/favorites keys are untouched', (tester) async {
      SharedPreferences.setMockInitialValues({
        'favorites.v1': ['p1'],
      });
      prefs = await SharedPreferences.getInstance();
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: _Api(), enableDeepLinks: false));
      await tester.pumpAndSettle();
      await tester.tap(find.text('المفضلة'));
      await tester.pumpAndSettle();
      var saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.tab, 2);
      openProduct(tester.element(find.byType(AppShell, skipOffstage: false)), 'fairy-lemon');
      await tester.pumpAndSettle();
      saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.productSlug, 'fairy-lemon');
      expect(saved.variantId, 'v1');
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
      saved = SessionSnapshot.fromJson(jsonDecode(prefs.getString(SessionStore.key)!))!;
      expect(saved.productSlug, isNull);
      expect(prefs.getStringList('favorites.v1'), ['p1']);
    });
  });
}

BuildContext context(WidgetTester tester) => tester.element(find.byType(AppShell, skipOffstage: false));

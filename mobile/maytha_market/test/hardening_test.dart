import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/money.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/l10n/gen/app_localizations.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/state/stores.dart';
import 'package:maytha_market/ui/screens/cart_screen.dart';
import 'package:maytha_market/ui/screens/product_screen.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/theme.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';
import 'widget_test.dart' show harness;

const _longName = 'أقراص غسالة الصحون فينيش كوانتوم باوربول برائحة الليمون – 45 او 72 قرص مع منظف إضافي';

/// Catalog with an extra long-named product, to stress text layout.
class _LongApi extends FakeStoreApi {
  _LongApi({super.quoteResult});
  Map<String, dynamic> _json(String locale) {
    final j = catalogJson(locale: locale);
    final products = j['products'] as List;
    final copy = Map<String, dynamic>.from(products.first as Map)
      ..['id'] = 'p9'
      ..['slug'] = 'long-one'
      ..['name'] = _longName
      ..['nameAr'] = _longName;
    products.add(copy);
    return j;
  }

  @override
  Future<Catalog> fetchCatalog(String locale) async => Catalog.fromJson(_json(locale));

  @override
  Future<Product> fetchProduct(String slug, String locale) async => Catalog.fromJson(_json(locale)).bySlug(slug)!;
}

Quote _quote(int subtotal) {
  // Server rule (Maythaloun only): below 50 ₪ → 5 ₪ delivery, from 50 ₪ → free.
  final fee = subtotal < 5000 ? 500 : 0;
  return Quote(
    lines: [
      QuoteLine(
        productId: 'p1',
        variantId: 'v1',
        sellingUnitId: 'u1',
        slug: 'fairy-lemon',
        name: 'سائل جلي فيري ليمون',
        options: '',
        unit: '',
        quantity: 1,
        unitPriceAgorot: subtotal,
        listUnitPriceAgorot: subtotal,
        lineSubtotalAgorot: subtotal,
      ),
    ],
    itemsSubtotalAgorot: subtotal,
    deliveryFeeAgorot: fee,
    totalAgorot: subtotal + fee,
  );
}

const _line = CartLine(
  productId: 'p1',
  slug: 'fairy-lemon',
  name: 'سائل جلي فيري ليمون',
  variantId: 'v1',
  variantLabel: '',
  sellingUnitId: 'u1',
  unitLabel: '',
  unitsPerSale: 1,
  unitPriceAgorot: 1250,
  maxQuantity: 5,
  quantity: 1,
);

void main() {
  late SharedPreferences prefs;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
  });

  Future<void> pumpCart(WidgetTester tester, FakeStoreApi api, {UrlOpener? openUrl}) async {
    final cart = CartStore(api, prefs)..add(_line);
    final catalog = CatalogStore(api);
    await catalog.load('ar');
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: cart),
          ChangeNotifierProvider.value(value: catalog),
          ChangeNotifierProvider.value(value: ShellController()..go(3)),
          ChangeNotifierProvider(create: (_) => LocaleStore(prefs)),
          ChangeNotifierProvider(create: (_) => FavoritesStore(prefs)),
        ],
        child: harness(CartScreen(openUrl: openUrl ?? (_) async => true)),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('free delivery boundary (49.99 / 50.00 / 50.01)', () {
    const d = DeliveryInfo();
    test('display logic', () {
      expect(freeDeliveryRemainingAgorot(4999, d), 1);
      expect(freeDeliveryRemainingAgorot(5000, d), 0);
      expect(freeDeliveryRemainingAgorot(5001, d), 0);
      expect(freeDeliveryProgress(4999, d), lessThan(1));
      expect(freeDeliveryProgress(5000, d), 1);
      expect(freeDeliveryProgress(5001, d), 1);
      expect(freeDeliveryProgress(0, d), 0);
    });

    for (final (subtotal, fee, total) in [
      (4999, '5 ₪', '54.99 ₪'),
      (5000, 'مجاني', '50 ₪'),
      (5001, 'مجاني', '50.01 ₪'),
    ]) {
      testWidgets('cart at ${formatAgorot(subtotal)} shows delivery $fee and total $total', (tester) async {
        await pumpCart(tester, FakeStoreApi(quoteResult: _quote(subtotal)));
        expect(find.text(formatAgorot(subtotal)), findsWidgets);
        expect(find.text(fee), findsOneWidget);
        expect(find.text(total), findsWidgets);
        final hint = tester.widget<Text>(find.byKey(const ValueKey('free-delivery-hint'))).data!;
        final l = await AppLocalizations.delegate.load(const Locale('ar'));
        expect(hint, subtotal < 5000 ? l.freeDeliveryHint(formatAgorot(5000 - subtotal)) : l.freeDeliveryReached);
        final bar = tester.widget<LinearProgressIndicator>(find.byKey(const ValueKey('free-delivery-progress')));
        expect(bar.value, subtotal < 5000 ? lessThan(1) : 1);
        expect(tester.takeException(), isNull);
      });
    }
  });

  testWidgets('WhatsApp: a double tap opens one chat with the order message, no form', (tester) async {
    final opened = <Uri>[];
    final gate = Completer<bool>();
    await pumpCart(
      tester,
      FakeStoreApi(quoteResult: sampleQuote),
      openUrl: (u) {
        opened.add(u);
        return gate.future;
      },
    );
    expect(find.byType(TextField), findsNothing); // no name/phone form
    final button = find.text('اطلب عبر واتساب');
    await tester.tap(button);
    await tester.tap(button, warnIfMissed: false);
    await tester.pump();
    await tester.tap(button, warnIfMissed: false);
    await tester.pump();
    gate.complete(true);
    await tester.pumpAndSettle();
    expect(opened, hasLength(1));
    expect(opened.single.toString(), startsWith('https://wa.me/972599105456?text='));
    expect(opened.single.queryParameters['text'], contains('سائل جلي فيري ليمون'));
  });

  testWidgets('WhatsApp: a launcher exception shows the unavailable message instead of crashing', (tester) async {
    await pumpCart(tester, FakeStoreApi(quoteResult: sampleQuote), openUrl: (_) async => throw Exception('no app'));
    await tester.tap(find.text('اطلب عبر واتساب'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsOneWidget);
    // The button is usable again.
    final btn = tester.widget<ButtonStyleButton>(
      find.ancestor(of: find.text('اطلب عبر واتساب'), matching: find.bySubtype<ButtonStyleButton>()),
    );
    expect(btn.onPressed, isNotNull);
  });

  test('text scale clamp stays accessible (>= 1.5)', () {
    expect(kMaxTextScale, greaterThanOrEqualTo(1.5));
  });

  // Every customer screen at large system font sizes on a 360x640dp phone.
  for (final locale in ['ar', 'en']) {
    for (final scale in [1.5, 2.0]) {
      testWidgets('all screens at text scale $scale ($locale, 360x640): no overflow, key actions reachable', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(360 * 3, 640 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        SharedPreferences.setMockInitialValues({'locale.v1': locale});
        prefs = await SharedPreferences.getInstance();
        final api = _LongApi(quoteResult: sampleQuote);
        await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // The app does not shrink the user's chosen size.
        final appCtx = tester.element(find.byType(AppShell));
        expect(MediaQuery.textScalerOf(appCtx).scale(10), closeTo(10 * scale, 0.01));

        final shell = appCtx.read<ShellController>();
        appCtx.read<CartStore>().add(_line);
        for (final tab in [0, 1, 2, 3, 4]) {
          shell.go(tab);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'tab $tab');
          final scrollables = find.byType(Scrollable).hitTestable();
          if (scrollables.evaluate().isNotEmpty) {
            await tester.drag(scrollables.first, const Offset(0, -3000));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull, reason: 'tab $tab scrolled');
          }
        }

        // Cart: the WhatsApp button stays on screen.
        shell.go(3);
        await tester.pumpAndSettle();
        final wa = tester.getRect(find.byIcon(Icons.chat_outlined));
        expect(wa.bottom, lessThanOrEqualTo(640));

        // Product details for the long-named product: add-to-cart stays on screen.
        openProduct(appCtx, 'long-one');
        await tester.pumpAndSettle();
        expect(find.byType(ProductScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
        final add = tester.getRect(find.byKey(const ValueKey('add-to-cart')));
        expect(add.bottom, lessThanOrEqualTo(640));
        expect(find.byKey(const ValueKey('product-price')), findsOneWidget);
        await tester.drag(find.byType(Scrollable).hitTestable().first, const Offset(0, -3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/l10n/gen/app_localizations.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/state/stores.dart';
import 'package:maytha_market/ui/screens/cart_screen.dart';
import 'package:maytha_market/ui/screens/shell.dart';
import 'package:maytha_market/ui/theme.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';

Widget harness(Widget child, {Locale locale = const Locale('ar')}) => MaterialApp(
      theme: buildTheme(),
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: child,
    );

void main() {
  late SharedPreferences prefs;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
  });

  testWidgets('product card shows name, brand, price and out-of-stock badge', (tester) async {
    final c = Catalog.fromJson(catalogJson());
    var tapped = false;
    await tester.pumpWidget(ChangeNotifierProvider(
      create: (_) => FavoritesStore(prefs),
      child: harness(Scaffold(
        body: Row(children: [
          SizedBox(width: 180, height: 320, child: ProductCard(product: c.products[0], onTap: () => tapped = true)),
          SizedBox(width: 180, height: 320, child: ProductCard(product: c.products[1], onTap: () {})),
        ]),
      )),
    ));
    expect(find.text('سائل جلي فيري ليمون'), findsOneWidget);
    expect(find.text('Fairy'), findsOneWidget);
    expect(find.text('12.5 ₪'), findsOneWidget);
    expect(find.text('غير متوفر'), findsOneWidget);
    await tester.tap(find.text('سائل جلي فيري ليمون'));
    expect(tapped, isTrue);

    await tester.tap(find.byTooltip('أضف إلى المفضلة').first);
    await tester.pump();
    expect(prefs.getStringList('favorites.v1'), ['p1']);
  });

  testWidgets('cart shows server totals from the quote endpoint and opens WhatsApp', (tester) async {
    final api = FakeStoreApi(quoteResult: sampleQuote);
    final cart = CartStore(api, prefs)
      ..add(const CartLine(
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
        quantity: 2,
      ));
    final catalog = CatalogStore(api);
    await catalog.load('ar');
    final shell = ShellController()..go(3);
    Uri? opened;

    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider.value(value: catalog),
        ChangeNotifierProvider.value(value: shell),
        ChangeNotifierProvider(create: (_) => LocaleStore(prefs)),
        ChangeNotifierProvider(create: (_) => FavoritesStore(prefs)),
      ],
      child: harness(CartScreen(openUrl: (u) async {
        opened = u;
        return true;
      })),
    ));
    await tester.pumpAndSettle();

    expect(api.quoteCalls, 1);
    expect(api.lastItems!.single.quantity, 2);
    expect(find.text('25 ₪'), findsOneWidget); // subtotal
    expect(find.text('5 ₪'), findsOneWidget); // delivery
    expect(find.text('30 ₪'), findsOneWidget); // total
    expect(find.text('أضف 25 ₪ للحصول على توصيل مجاني'), findsOneWidget);

    await tester.tap(find.text('اطلب عبر واتساب'));
    await tester.pumpAndSettle();
    expect(opened, isNotNull);
    expect(opened!.host, 'wa.me');
    expect(opened!.path, '/972599105456');
    expect(opened!.queryParameters['text'], startsWith('مرحباً MAYTHA 🌿\n\nبدي أطلب المنتجات التالية:'));
  });

  testWidgets('cart shows a mapped error when the quote fails', (tester) async {
    final api = FakeStoreApi(quoteError: 'insufficient_stock');
    final cart = CartStore(api, prefs)
      ..add(const CartLine(
        productId: 'p1',
        slug: 'fairy-lemon',
        name: 'x',
        variantId: 'v1',
        variantLabel: '',
        sellingUnitId: 'u1',
        unitLabel: '',
        unitsPerSale: 1,
        unitPriceAgorot: 1250,
        maxQuantity: 5,
        quantity: 1,
      ));
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider(create: (_) => CatalogStore(api)),
        ChangeNotifierProvider(create: (_) => ShellController()..go(3)),
        ChangeNotifierProvider(create: (_) => LocaleStore(prefs)),
        ChangeNotifierProvider(create: (_) => FavoritesStore(prefs)),
      ],
      child: harness(const CartScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('الكمية المطلوبة غير متوفرة لأحد المنتجات. قلّل الكمية.'), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
  });

  testWidgets('app is RTL in Arabic by default and LTR in English', (tester) async {
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: FakeStoreApi(), enableDeepLinks: false));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.rtl);
    expect(find.text('ماركات بتعرفها وبتثق فيها، لبيت أنظف وأجمل'), findsOneWidget);
    expect(find.text('MAYTHA MARKET'), findsWidgets);

    // Switch language from Settings.
    await tester.tap(find.text('الإعدادات'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byType(AppShell))), TextDirection.ltr);
    expect(prefs.getString('locale.v1'), 'en');
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(find.text('Brands You Know and Trust, for a Cleaner, Brighter Home'), findsOneWidget);
  });

  testWidgets('home shows error state with retry', (tester) async {
    final api = FakeStoreApi(failCatalog: true);
    await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
    await tester.pumpAndSettle();
    expect(find.text('إعادة المحاولة'), findsWidgets);
    api.failCatalog = false;
    await tester.tap(find.text('إعادة المحاولة').first);
    await tester.pumpAndSettle();
    expect(find.text('سائل جلي فيري ليمون'), findsWidgets);
  });

  test('api exception carries code', () {
    expect(ApiException('x', code: 'rate_limited').code, 'rate_limited');
  });
}

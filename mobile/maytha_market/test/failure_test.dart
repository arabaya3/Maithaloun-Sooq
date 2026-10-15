import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/ui/widgets/common.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';

HttpStoreApi apiWith(MockClientHandler handler, {Duration timeout = const Duration(seconds: 20)}) =>
    HttpStoreApi(client: MockClient(handler), baseUrl: 'https://example.test', timeout: timeout);

http.Response jsonRes(Object body, [int status = 200]) => http.Response.bytes(
    utf8.encode(jsonEncode(body)), status,
    headers: {'content-type': 'application/json; charset=utf-8'});

const item = QuoteItem(productId: 'p1', variantId: 'v1', sellingUnitId: 'u1', unitsPerSale: 1, quantity: 1);

void main() {
  group('HttpStoreApi failures', () {
    test('HTTP 500 throws ApiException with status', () async {
      final api = apiWith((_) async => jsonRes({'ok': false, 'error': 'internal'}, 500));
      await expectLater(
          api.fetchCatalog('ar'), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 500)));
    });

    test('non-JSON body (e.g. HTML error page) throws ApiException', () async {
      final api = apiWith((_) async => http.Response('<html>502</html>', 502));
      await expectLater(api.fetchCatalog('ar'), throwsA(isA<ApiException>()));
    });

    test('network error throws ApiException', () async {
      final api = apiWith((_) async => throw http.ClientException('Failed host lookup'));
      await expectLater(api.fetchProduct('x', 'ar'), throwsA(isA<ApiException>()));
    });

    test('timeout throws ApiException', () async {
      final api = apiWith((_) => Completer<http.Response>().future, timeout: const Duration(milliseconds: 50));
      await expectLater(
          api.fetchCatalog('ar'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Timeout')));
    });

    test('empty catalog parses to zero products', () async {
      final api = apiWith((_) async => jsonRes({'ok': true, 'locale': 'ar', 'categories': [], 'products': []}));
      final c = await api.fetchCatalog('ar');
      expect(c.products, isEmpty);
    });

    test('quote keeps known error codes and drops unknown ones', () async {
      var code = 'insufficient_stock';
      final api = apiWith((_) async => jsonRes({'ok': false, 'error': code}, 409));
      await expectLater(api.quote([item], 'ar'),
          throwsA(isA<ApiException>().having((e) => e.code, 'code', 'insufficient_stock')));
      code = 'something_internal';
      await expectLater(api.quote([item], 'ar'), throwsA(isA<ApiException>().having((e) => e.code, 'code', null)));
    });

    test('product 404 throws ApiException', () async {
      final api = apiWith((_) async => jsonRes({'ok': false, 'error': 'not_found'}, 404));
      await expectLater(api.fetchProduct('missing', 'ar'),
          throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 404)));
    });
  });

  group('app failure UI', () {
    late SharedPreferences prefs;
    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      prefs = await SharedPreferences.getInstance();
    });

    testWidgets('timeout shows error with retry and recovers', (tester) async {
      var fail = true;
      final api = apiWith((req) async {
        if (fail) throw TimeoutException('slow');
        return jsonRes(catalogJson());
      });
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.text('تعذّر تحميل المتجر. تحقق من الاتصال وحاول مرة أخرى.'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('إعادة المحاولة').first);
      await tester.pumpAndSettle();
      expect(find.byType(ProductCard), findsWidgets);
    });

    testWidgets('empty catalog shows an empty state instead of a blank page', (tester) async {
      final api = apiWith((_) async => jsonRes({'ok': true, 'locale': 'ar', 'categories': [], 'products': []}));
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ProductCard), findsNothing);
      expect(find.text('لا توجد منتجات متاحة حالياً. عاود الزيارة قريباً.'), findsOneWidget);
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      await tester.tap(find.text('المتجر'));
      await tester.pumpAndSettle();
      expect(find.text('لا توجد منتجات متاحة حالياً. عاود الزيارة قريباً.'), findsOneWidget);
    });

    testWidgets('API error from fake client shows error then recovers', (tester) async {
      final api = FakeStoreApi(failCatalog: true);
      await tester.pumpWidget(MaythaApp(prefs: prefs, api: api, enableDeepLinks: false));
      await tester.pumpAndSettle();
      expect(find.byType(ErrorView), findsWidgets);
      api.failCatalog = false;
      await tester.tap(find.text('إعادة المحاولة').first);
      await tester.pumpAndSettle();
      expect(find.byType(ErrorView), findsNothing);
    });
  });
}

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/state/stores.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures.dart';

/// Answers only when the test completes the matching completer, like a slow network.
class SlowStoreApi extends FakeStoreApi {
  SlowStoreApi() : super(quoteResult: sampleQuote);
  final catalog = Completer<Catalog>();
  final quoteAnswer = Completer<Quote>();

  @override
  Future<Catalog> fetchCatalog(String locale) => catalog.future;

  @override
  Future<Quote> quote(List<QuoteItem> items, String locale) => quoteAnswer.future;
}

void main() {
  test('a catalog that arrives after the store is disposed is dropped quietly', () async {
    final api = SlowStoreApi();
    final store = CatalogStore(api);
    final pending = store.load('en');
    store.dispose();
    api.catalog.complete(Catalog.fromJson(catalogJson(locale: 'en')));
    await expectLater(pending, completes);
    expect(store.isDisposed, isTrue);
  });

  test('a quote that arrives after the cart is disposed is dropped quietly', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final api = SlowStoreApi();
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
        maxQuantity: 10,
        quantity: 1,
      ));
    final pending = cart.refreshQuote('ar');
    cart.dispose();
    api.quoteAnswer.complete(sampleQuote);
    await expectLater(pending, completes);
  });
}

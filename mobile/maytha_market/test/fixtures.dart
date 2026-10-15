import 'package:maytha_market/data/api_client.dart';
import 'package:maytha_market/data/models.dart';

/// Catalog fixture following the /api/v1/catalog contract.
Map<String, dynamic> catalogJson({String locale = 'ar'}) => {
      'ok': true,
      'version': 1,
      'locale': locale,
      'store': {
        'name': 'MAYTHA MARKET',
        'currency': 'ILS',
        'whatsAppE164': '+972599105456',
        'delivery': {
          'area': 'maythalun',
          'feeAgorot': 500,
          'freeFromAgorot': 5000,
          'payment': 'cash_on_delivery',
        },
      },
      'categories': [
        {'code': 'cleaning', 'name': locale == 'ar' ? 'منظفات' : 'Cleaning', 'icon': 'spray'},
        {'code': 'tools', 'name': locale == 'ar' ? 'أدوات' : 'Tools', 'icon': 'broom'},
      ],
      'products': [
        {
          'id': 'p1',
          'slug': 'fairy-lemon',
          'name': locale == 'ar' ? 'سائل جلي فيري ليمون' : 'Fairy Lemon Dish Soap',
          'nameAr': 'سائل جلي فيري ليمون',
          'brand': 'Fairy',
          'categoryCode': 'cleaning',
          'available': true,
          'priceAgorot': 1250,
          'image': {'src': '/products/fairy.webp', 'alt': 'Fairy', 'width': 800, 'height': 800},
          'description': 'سائل جلي مركز.\nطريقة الاستعمال:\nضع كمية قليلة على الإسفنجة.',
          'usageNotes': null,
          'defaultVariantId': 'v1',
          'variants': [
            {
              'id': 'v1',
              'label': '500 مل',
              'attributes': {'size': '500ml'},
              'available': true,
              'image': null,
              'offer': null,
              'sellingUnits': [
                {
                  'id': 'u1',
                  'label': 'حبة',
                  'unitsPerSale': 1,
                  'priceAgorot': 1250,
                  'isDefault': true,
                  'maxQuantity': 5,
                },
                {
                  'id': 'u2',
                  'label': 'كرتونة 6',
                  'unitsPerSale': 6,
                  'priceAgorot': 6900,
                  'isDefault': false,
                  'maxQuantity': 2,
                },
              ],
            },
          ],
        },
        {
          'id': 'p2',
          'slug': 'broom',
          'name': locale == 'ar' ? 'مكنسة' : 'Broom',
          'nameAr': 'مكنسة',
          'brand': null,
          'categoryCode': 'tools',
          'available': false,
          'priceAgorot': 2000,
          'image': {
            'src': 'https://example.supabase.co/storage/v1/object/public/p/broom.webp',
            'alt': 'Broom',
            'width': 600,
            'height': 600,
          },
          'description': null,
          'usageNotes': null,
          'defaultVariantId': 'v2',
          'variants': [
            {
              'id': 'v2',
              'label': 'Default',
              'attributes': <String, String>{},
              'available': false,
              'image': null,
              'offer': null,
              'sellingUnits': [
                {
                  'id': 'u3',
                  'label': 'حبة',
                  'unitsPerSale': 1,
                  'priceAgorot': 2000,
                  'isDefault': true,
                  'maxQuantity': 0,
                },
              ],
            },
          ],
        },
      ],
    };

class FakeStoreApi implements StoreApi {
  FakeStoreApi({this.quoteResult, this.quoteError, this.failCatalog = false});
  Quote? quoteResult;
  String? quoteError;
  bool failCatalog;
  int quoteCalls = 0;
  List<QuoteItem>? lastItems;

  @override
  Future<Catalog> fetchCatalog(String locale) async {
    if (failCatalog) throw ApiException('offline');
    return Catalog.fromJson(catalogJson(locale: locale));
  }

  @override
  Future<Product> fetchProduct(String slug, String locale) async {
    final c = Catalog.fromJson(catalogJson(locale: locale));
    final p = c.bySlug(slug);
    if (p == null) throw ApiException('not found', statusCode: 404);
    return p;
  }

  @override
  Future<Quote> quote(List<QuoteItem> items, String locale) async {
    quoteCalls++;
    lastItems = items;
    if (quoteError != null) throw ApiException('quote', code: quoteError, statusCode: 409);
    return quoteResult!;
  }
}

const sampleQuote = Quote(
  lines: [
    QuoteLine(
      productId: 'p1',
      variantId: 'v1',
      sellingUnitId: 'u1',
      slug: 'fairy-lemon',
      name: 'سائل جلي فيري ليمون',
      options: '500 مل',
      unit: 'حبة',
      quantity: 2,
      unitPriceAgorot: 1250,
      listUnitPriceAgorot: 1250,
      lineSubtotalAgorot: 2500,
    ),
  ],
  itemsSubtotalAgorot: 2500,
  deliveryFeeAgorot: 500,
  totalAgorot: 3000,
);

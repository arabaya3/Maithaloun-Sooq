import 'package:flutter_test/flutter_test.dart';
import 'package:maytha_market/app.dart';
import 'package:maytha_market/core/arabic_normalize.dart';
import 'package:maytha_market/core/config.dart';
import 'package:maytha_market/core/description_split.dart';
import 'package:maytha_market/core/money.dart';
import 'package:maytha_market/core/whatsapp_message.dart';
import 'package:maytha_market/data/models.dart';
import 'package:maytha_market/state/cart.dart';
import 'package:maytha_market/ui/screens/catalog_screen.dart';

import 'fixtures.dart';

CartLine line({String unit = 'u1', int q = 1, int max = 5, int price = 1250}) => CartLine(
      productId: 'p1',
      slug: 'fairy-lemon',
      name: 'Fairy',
      variantId: 'v1',
      variantLabel: '',
      sellingUnitId: unit,
      unitLabel: '',
      unitsPerSale: 1,
      unitPriceAgorot: price,
      maxQuantity: max,
      quantity: q,
    );

void main() {
  group('money', () {
    test('formats whole, one and two decimals', () {
      expect(formatAgorot(1200), '12 ₪');
      expect(formatAgorot(1250), '12.5 ₪');
      expect(formatAgorot(1205), '12.05 ₪');
      expect(formatAgorot(0), '0 ₪');
      expect(formatAgorot(5), '0.05 ₪');
      expect(formatAgorot(500000), '5000 ₪');
    });
  });

  group('arabic normalization', () {
    test('strips diacritics and tatweel', () {
      expect(normalizeForSearch('مُنَظِّـــف'), 'منظف');
    });
    test('unifies alef, taa marbuta and alef maqsura', () {
      expect(normalizeForSearch('أإآ'), 'ااا');
      expect(normalizeForSearch('مكنسة'), 'مكنسه');
      expect(normalizeForSearch('مستشفى'), 'مستشفي');
    });
    test('lower-cases and collapses spaces', () {
      expect(normalizeForSearch('  Fairy   LEMON '), 'fairy lemon');
    });
    test('search matches normalized forms and brand', () {
      final c = Catalog.fromJson(catalogJson());
      expect(filterProducts(c.products, query: 'مكنسه').map((p) => p.id), ['p2']);
      expect(filterProducts(c.products, query: 'fairy').map((p) => p.id), ['p1']);
      expect(filterProducts(c.products, query: 'سَائِل').map((p) => p.id), ['p1']);
      expect(filterProducts(c.products, category: 'tools').map((p) => p.id), ['p2']);
      expect(filterProducts(c.products, sort: SortMode.priceHigh).first.id, 'p2');
      expect(filterProducts(c.products, sort: SortMode.priceLow).first.id, 'p1');
    });
  });

  group('description split', () {
    test('splits at طريقة الاستعمال: line', () {
      final r = splitDescription('سائل مركز.\nيزيل الدهون.\nطريقة الاستعمال:\nضع كمية قليلة.\nاشطف.');
      expect(r.description, 'سائل مركز.\nيزيل الدهون.');
      expect(r.usage, 'ضع كمية قليلة.\nاشطف.');
    });
    test('splits at الاستعمال: line with surrounding spaces', () {
      final r = splitDescription('وصف\n  الاستعمال:  \nرش');
      expect(r.description, 'وصف');
      expect(r.usage, 'رش');
    });
    test('does not split on inline mentions', () {
      final r = splitDescription('طريقة الاستعمال: رش على السطح');
      expect(r.usage, isNull);
      expect(r.description, 'طريقة الاستعمال: رش على السطح');
    });
    test('keeps all text when one side is empty', () {
      final r = splitDescription('طريقة الاستعمال:\nرش');
      expect(r.usage, isNull);
      expect(r.description, 'طريقة الاستعمال:\nرش');
    });
  });

  group('whatsapp message', () {
    test('Arabic message matches the website lines exactly', () {
      final msg = buildWhatsAppOrderMessage(
          quote: sampleQuote, arabic: true, storeUrl: 'https://maithaloun-sooq.vercel.app');
      expect(msg.split('\n'), [
        'مرحباً MAYTHA 🌿',
        '',
        'بدي أطلب المنتجات التالية:',
        '',
        '1. سائل جلي فيري ليمون',
        '   النوع: 500 مل · حبة',
        '   الكمية: 2',
        '   السعر: 25 ₪',
        '',
        'المجموع: 25 ₪',
        'التوصيل: 5 ₪',
        'الإجمالي: 30 ₪',
        'الدفع نقداً عند الاستلام.',
        '',
        'رابط المتجر: https://maithaloun-sooq.vercel.app',
      ]);
    });
    test('English message and omitted option line', () {
      const q = Quote(
        lines: [
          QuoteLine(
              productId: 'p',
              variantId: 'v',
              sellingUnitId: 'u',
              slug: 's',
              name: 'Broom',
              options: null,
              unit: null,
              quantity: 1,
              unitPriceAgorot: 5050,
              listUnitPriceAgorot: 5050,
              lineSubtotalAgorot: 5050),
        ],
        itemsSubtotalAgorot: 5050,
        deliveryFeeAgorot: 0,
        totalAgorot: 5050,
      );
      final msg = buildWhatsAppOrderMessage(quote: q, arabic: false, storeUrl: 'https://x.test');
      expect(msg.split('\n'), [
        'Hello MAYTHA 🌿',
        '',
        "I'd like to order:",
        '',
        '1. Broom',
        '   Quantity: 1',
        '   Price: 50.5 ₪',
        '',
        'Subtotal: 50.5 ₪',
        'Delivery: 0 ₪',
        'Total: 50.5 ₪',
        'Cash on delivery.',
        '',
        'Store: https://x.test',
      ]);
    });
    test('wa.me link uses digits and encodes text', () {
      final uri = whatsAppUri('+972599105456', 'مرحباً 🌿\nx');
      expect(uri.toString(), startsWith('https://wa.me/972599105456?text='));
      expect(uri!.queryParameters['text'], 'مرحباً 🌿\nx');
      expect(whatsAppUri(null, 'x'), isNull);
    });
  });

  group('cart model', () {
    test('merges same line and caps at maxQuantity', () {
      final c = CartModel()
        ..add(line(q: 3))
        ..add(line(q: 4));
      expect(c.lines.length, 1);
      expect(c.lines.single.quantity, 5);
    });
    test('different selling units are separate lines', () {
      final c = CartModel()
        ..add(line())
        ..add(line(unit: 'u2', price: 6900, max: 2));
      expect(c.lines.length, 2);
      expect(c.itemCount, 2);
      expect(c.estimatedSubtotalAgorot, 8150);
    });
    test('setQuantity clamps and removes at zero', () {
      final c = CartModel()..add(line());
      final key = c.lines.single.key;
      c.setQuantity(key, 99);
      expect(c.lines.single.quantity, 5);
      c.setQuantity(key, 0);
      expect(c.isEmpty, isTrue);
    });
    test('encode/decode round trip and quote items', () {
      final c = CartModel()..add(line(q: 2));
      final d = CartModel.decode(c.encode());
      expect(d.lines.single.quantity, 2);
      expect(d.toQuoteItems().single.toJson(), {
        'productId': 'p1',
        'variantId': 'v1',
        'sellingUnitId': 'u1',
        'unitsPerSale': 1,
        'quantity': 2,
      });
      expect(CartModel.decode('not json').isEmpty, isTrue);
    });
  });

  group('parsing and links', () {
    test('catalog fixture parses', () {
      final c = Catalog.fromJson(catalogJson());
      expect(c.store.whatsAppE164, '+972599105456');
      expect(c.store.delivery.freeFromAgorot, 5000);
      expect(c.products.first.defaultVariant!.defaultUnit!.id, 'u1');
      expect(c.products.first.gallery.length, 1);
    });
    test('relative image URLs are resolved', () {
      expect(AppConfig.resolveUrl('/a.webp', base: 'https://s.test'), 'https://s.test/a.webp');
      expect(AppConfig.resolveUrl('https://x.supabase.co/a.webp', base: 'https://s.test'),
          'https://x.supabase.co/a.webp');
    });
    test('deep link slugs', () {
      expect(slugFromDeepLink(Uri.parse('maytha://product/fairy-lemon')), 'fairy-lemon');
      expect(slugFromDeepLink(Uri.parse('https://maithaloun-sooq.vercel.app/products/broom')), 'broom');
      expect(slugFromDeepLink(Uri.parse('https://maithaloun-sooq.vercel.app/ar/products/broom')), 'broom');
      expect(slugFromDeepLink(Uri.parse('https://maithaloun-sooq.vercel.app/about')), isNull);
    });
  });
}

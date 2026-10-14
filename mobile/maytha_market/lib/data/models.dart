// Models for the public read-only store API (v1). Parsing is defensive: unknown
// or missing optional fields fall back to null/empty instead of throwing.

int _int(Object? v, [int fallback = 0]) => v is num ? v.toInt() : fallback;
String? _str(Object? v) => v is String ? v : null;
bool _bool(Object? v) => v == true;
List<Map<String, dynamic>> _list(Object? v) =>
    v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];

class ProductImage {
  const ProductImage({required this.src, required this.alt, this.width, this.height});
  final String src;
  final String alt;
  final int? width;
  final int? height;

  static ProductImage? fromJson(Object? json) {
    if (json is! Map) return null;
    final src = _str(json['src']);
    if (src == null || src.isEmpty) return null;
    return ProductImage(
      src: src,
      alt: _str(json['alt']) ?? '',
      width: json['width'] is num ? (json['width'] as num).toInt() : null,
      height: json['height'] is num ? (json['height'] as num).toInt() : null,
    );
  }
}

class Offer {
  const Offer({required this.kind, required this.value, required this.minQuantity});
  final String kind;
  final num value;
  final int minQuantity;

  static Offer? fromJson(Object? json) {
    if (json is! Map) return null;
    return Offer(
      kind: _str(json['kind']) ?? '',
      value: json['value'] is num ? json['value'] as num : 0,
      minQuantity: _int(json['minQuantity'], 1),
    );
  }
}

class SellingUnit {
  const SellingUnit({
    required this.id,
    required this.label,
    required this.unitsPerSale,
    required this.priceAgorot,
    required this.isDefault,
    required this.maxQuantity,
  });
  final String id;
  final String label;
  final int unitsPerSale;
  final int priceAgorot;
  final bool isDefault;
  final int maxQuantity;

  factory SellingUnit.fromJson(Map<String, dynamic> j) => SellingUnit(
        id: '${j['id']}',
        label: _str(j['label']) ?? '',
        unitsPerSale: _int(j['unitsPerSale'], 1),
        priceAgorot: _int(j['priceAgorot']),
        isDefault: _bool(j['isDefault']),
        maxQuantity: _int(j['maxQuantity'], 99),
      );
}

class Variant {
  const Variant({
    required this.id,
    required this.label,
    required this.attributes,
    required this.available,
    required this.image,
    required this.offer,
    required this.sellingUnits,
  });
  final String id;
  final String label;
  final Map<String, String> attributes;
  final bool available;
  final ProductImage? image;
  final Offer? offer;
  final List<SellingUnit> sellingUnits;

  SellingUnit? get defaultUnit {
    if (sellingUnits.isEmpty) return null;
    return sellingUnits.firstWhere((u) => u.isDefault, orElse: () => sellingUnits.first);
  }

  factory Variant.fromJson(Map<String, dynamic> j) {
    final attrs = <String, String>{};
    final raw = j['attributes'];
    if (raw is Map) {
      raw.forEach((k, v) => attrs['$k'] = '$v');
    }
    return Variant(
      id: '${j['id']}',
      label: _str(j['label']) ?? '',
      attributes: attrs,
      available: _bool(j['available']),
      image: ProductImage.fromJson(j['image']),
      offer: Offer.fromJson(j['offer']),
      sellingUnits: _list(j['sellingUnits']).map(SellingUnit.fromJson).toList(),
    );
  }
}

class Product {
  const Product({
    required this.id,
    required this.slug,
    required this.name,
    required this.nameAr,
    required this.brand,
    required this.categoryCode,
    required this.available,
    required this.priceAgorot,
    required this.image,
    required this.description,
    required this.usageNotes,
    required this.defaultVariantId,
    required this.variants,
  });
  final String id;
  final String slug;
  final String name;
  final String nameAr;
  final String? brand;
  final String categoryCode;
  final bool available;
  final int priceAgorot;
  final ProductImage? image;
  final String? description;
  final String? usageNotes;
  final String? defaultVariantId;
  final List<Variant> variants;

  Variant? get defaultVariant {
    if (variants.isEmpty) return null;
    return variants.firstWhere((v) => v.id == defaultVariantId, orElse: () => variants.first);
  }

  /// Distinct gallery images: the main image followed by variant images.
  List<ProductImage> get gallery {
    final seen = <String>{};
    final out = <ProductImage>[];
    for (final img in [image, ...variants.map((v) => v.image)]) {
      if (img != null && seen.add(img.src)) out.add(img);
    }
    return out;
  }

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: '${j['id']}',
        slug: _str(j['slug']) ?? '',
        name: _str(j['name']) ?? '',
        nameAr: _str(j['nameAr']) ?? _str(j['name']) ?? '',
        brand: _str(j['brand']),
        categoryCode: _str(j['categoryCode']) ?? '',
        available: _bool(j['available']),
        priceAgorot: _int(j['priceAgorot']),
        image: ProductImage.fromJson(j['image']),
        description: _str(j['description']),
        usageNotes: _str(j['usageNotes']),
        defaultVariantId: j['defaultVariantId'] == null ? null : '${j['defaultVariantId']}',
        variants: _list(j['variants']).map(Variant.fromJson).toList(),
      );
}

class Category {
  const Category({required this.code, required this.name, this.icon});
  final String code;
  final String name;
  final String? icon;
  factory Category.fromJson(Map<String, dynamic> j) =>
      Category(code: _str(j['code']) ?? '', name: _str(j['name']) ?? '', icon: _str(j['icon']));
}

class DeliveryInfo {
  const DeliveryInfo({
    this.area = 'maythalun',
    this.feeAgorot = 500,
    this.freeFromAgorot = 5000,
    this.payment = 'cash_on_delivery',
  });
  final String area;
  final int feeAgorot;
  final int freeFromAgorot;
  final String payment;
  factory DeliveryInfo.fromJson(Object? j) {
    if (j is! Map) return const DeliveryInfo();
    return DeliveryInfo(
      area: _str(j['area']) ?? 'maythalun',
      feeAgorot: _int(j['feeAgorot'], 500),
      freeFromAgorot: _int(j['freeFromAgorot'], 5000),
      payment: _str(j['payment']) ?? 'cash_on_delivery',
    );
  }
}

class StoreInfo {
  const StoreInfo({
    required this.name,
    required this.currency,
    required this.whatsAppE164,
    required this.delivery,
  });
  final String name;
  final String currency;
  final String? whatsAppE164;
  final DeliveryInfo delivery;
  factory StoreInfo.fromJson(Object? j) {
    final m = j is Map ? j.cast<String, dynamic>() : const <String, dynamic>{};
    return StoreInfo(
      name: _str(m['name']) ?? 'MAYTHA MARKET',
      currency: _str(m['currency']) ?? 'ILS',
      whatsAppE164: _str(m['whatsAppE164']),
      delivery: DeliveryInfo.fromJson(m['delivery']),
    );
  }
}

class Catalog {
  const Catalog({
    required this.locale,
    required this.store,
    required this.categories,
    required this.products,
  });
  final String locale;
  final StoreInfo store;
  final List<Category> categories;
  final List<Product> products;

  factory Catalog.fromJson(Map<String, dynamic> j) => Catalog(
        locale: _str(j['locale']) ?? 'ar',
        store: StoreInfo.fromJson(j['store']),
        categories: _list(j['categories']).map(Category.fromJson).toList(),
        products: _list(j['products']).map(Product.fromJson).toList(),
      );

  Product? bySlug(String slug) {
    for (final p in products) {
      if (p.slug == slug) return p;
    }
    return null;
  }

  Product? byId(String id) {
    for (final p in products) {
      if (p.id == id) return p;
    }
    return null;
  }
}

class QuoteLine {
  const QuoteLine({
    required this.productId,
    required this.variantId,
    required this.sellingUnitId,
    required this.slug,
    required this.name,
    required this.options,
    required this.unit,
    required this.quantity,
    required this.unitPriceAgorot,
    required this.listUnitPriceAgorot,
    required this.lineSubtotalAgorot,
  });
  final String productId;
  final String variantId;
  final String sellingUnitId;
  final String slug;
  final String name;
  final String? options;
  final String? unit;
  final int quantity;
  final int unitPriceAgorot;
  final int listUnitPriceAgorot;
  final int lineSubtotalAgorot;

  factory QuoteLine.fromJson(Map<String, dynamic> j) => QuoteLine(
        productId: '${j['productId']}',
        variantId: '${j['variantId']}',
        sellingUnitId: '${j['sellingUnitId']}',
        slug: _str(j['slug']) ?? '',
        name: _str(j['name']) ?? '',
        options: _str(j['options']),
        unit: _str(j['unit']),
        quantity: _int(j['quantity'], 1),
        unitPriceAgorot: _int(j['unitPriceAgorot']),
        listUnitPriceAgorot: _int(j['listUnitPriceAgorot']),
        lineSubtotalAgorot: _int(j['lineSubtotalAgorot']),
      );
}

class Quote {
  const Quote({
    required this.lines,
    required this.itemsSubtotalAgorot,
    required this.deliveryFeeAgorot,
    required this.totalAgorot,
  });
  final List<QuoteLine> lines;
  final int itemsSubtotalAgorot;
  final int deliveryFeeAgorot;
  final int totalAgorot;

  factory Quote.fromJson(Map<String, dynamic> j) => Quote(
        lines: _list(j['lines']).map(QuoteLine.fromJson).toList(),
        itemsSubtotalAgorot: _int(j['itemsSubtotalAgorot']),
        deliveryFeeAgorot: _int(j['deliveryFeeAgorot']),
        totalAgorot: _int(j['totalAgorot']),
      );
}

class QuoteItem {
  const QuoteItem({
    required this.productId,
    required this.variantId,
    required this.sellingUnitId,
    required this.unitsPerSale,
    required this.quantity,
  });
  final String productId;
  final String variantId;
  final String sellingUnitId;
  final int unitsPerSale;
  final int quantity;

  Map<String, dynamic> toJson() => {
        'productId': productId,
        'variantId': variantId,
        'sellingUnitId': sellingUnitId,
        'unitsPerSale': unitsPerSale,
        'quantity': quantity,
      };
}

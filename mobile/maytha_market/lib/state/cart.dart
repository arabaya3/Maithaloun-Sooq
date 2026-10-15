import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api_client.dart';
import '../data/models.dart';
import 'dispose_safe.dart';

/// One cart line: a product variant sold in a given selling unit.
@immutable
class CartLine {
  const CartLine({
    required this.productId,
    required this.slug,
    required this.name,
    required this.variantId,
    required this.variantLabel,
    required this.sellingUnitId,
    required this.unitLabel,
    required this.unitsPerSale,
    required this.unitPriceAgorot,
    required this.maxQuantity,
    required this.quantity,
    this.imageSrc,
  });

  final String productId;
  final String slug;
  final String name;
  final String variantId;
  final String variantLabel;
  final String sellingUnitId;
  final String unitLabel;
  final int unitsPerSale;
  final int unitPriceAgorot;
  final int maxQuantity;
  final int quantity;
  final String? imageSrc;

  String get key => '$productId|$variantId|$sellingUnitId';
  int get estimatedSubtotalAgorot => unitPriceAgorot * quantity;

  CartLine copyWith({int? quantity}) => CartLine(
        productId: productId,
        slug: slug,
        name: name,
        variantId: variantId,
        variantLabel: variantLabel,
        sellingUnitId: sellingUnitId,
        unitLabel: unitLabel,
        unitsPerSale: unitsPerSale,
        unitPriceAgorot: unitPriceAgorot,
        maxQuantity: maxQuantity,
        quantity: quantity ?? this.quantity,
        imageSrc: imageSrc,
      );

  QuoteItem toQuoteItem() => QuoteItem(
        productId: productId,
        variantId: variantId,
        sellingUnitId: sellingUnitId,
        unitsPerSale: unitsPerSale,
        quantity: quantity,
      );

  Map<String, dynamic> toJson() => {
        'productId': productId,
        'slug': slug,
        'name': name,
        'variantId': variantId,
        'variantLabel': variantLabel,
        'sellingUnitId': sellingUnitId,
        'unitLabel': unitLabel,
        'unitsPerSale': unitsPerSale,
        'unitPriceAgorot': unitPriceAgorot,
        'maxQuantity': maxQuantity,
        'quantity': quantity,
        'imageSrc': imageSrc,
      };

  static CartLine? fromJson(Object? j) {
    if (j is! Map) return null;
    try {
      return CartLine(
        productId: j['productId'] as String,
        slug: j['slug'] as String,
        name: j['name'] as String,
        variantId: j['variantId'] as String,
        variantLabel: (j['variantLabel'] as String?) ?? '',
        sellingUnitId: j['sellingUnitId'] as String,
        unitLabel: (j['unitLabel'] as String?) ?? '',
        unitsPerSale: (j['unitsPerSale'] as num).toInt(),
        unitPriceAgorot: (j['unitPriceAgorot'] as num).toInt(),
        maxQuantity: (j['maxQuantity'] as num).toInt(),
        quantity: (j['quantity'] as num).toInt(),
        imageSrc: j['imageSrc'] as String?,
      );
    } catch (_) {
      return null;
    }
  }
}

/// Pure cart logic, independent of storage and network (unit-testable).
class CartModel {
  CartModel([List<CartLine>? lines]) : _lines = [...?lines];
  final List<CartLine> _lines;

  List<CartLine> get lines => List.unmodifiable(_lines);
  bool get isEmpty => _lines.isEmpty;
  int get itemCount => _lines.fold(0, (s, l) => s + l.quantity);
  int get estimatedSubtotalAgorot => _lines.fold(0, (s, l) => s + l.estimatedSubtotalAgorot);

  static int _clamp(int q, int max) => q < 1 ? 1 : (max > 0 && q > max ? max : q);

  /// Adds [line]; merges with an existing line for the same variant and selling unit.
  void add(CartLine line) {
    final i = _lines.indexWhere((l) => l.key == line.key);
    if (i >= 0) {
      final merged = _lines[i].quantity + line.quantity;
      _lines[i] = _lines[i].copyWith(quantity: _clamp(merged, line.maxQuantity));
    } else {
      _lines.add(line.copyWith(quantity: _clamp(line.quantity, line.maxQuantity)));
    }
  }

  void setQuantity(String key, int quantity) {
    final i = _lines.indexWhere((l) => l.key == key);
    if (i < 0) return;
    if (quantity <= 0) {
      _lines.removeAt(i);
    } else {
      _lines[i] = _lines[i].copyWith(quantity: _clamp(quantity, _lines[i].maxQuantity));
    }
  }

  void remove(String key) => _lines.removeWhere((l) => l.key == key);
  void clear() => _lines.clear();

  List<QuoteItem> toQuoteItems() => _lines.map((l) => l.toQuoteItem()).toList();

  String encode() => jsonEncode(_lines.map((l) => l.toJson()).toList());
  static CartModel decode(String? raw) {
    if (raw == null || raw.isEmpty) return CartModel();
    try {
      final list = jsonDecode(raw);
      if (list is! List) return CartModel();
      return CartModel(list.map(CartLine.fromJson).whereType<CartLine>().toList());
    } catch (_) {
      return CartModel();
    }
  }
}

enum QuoteStatus { idle, loading, ready, error }

/// Cart state persisted to shared_preferences, with server-side totals from the quote endpoint.
class CartStore extends ChangeNotifier with DisposeSafeNotifier {
  CartStore(this._api, this._prefs) : _model = CartModel.decode(_prefs.getString(_key));

  static const _key = 'cart.v1';
  final StoreApi _api;
  final SharedPreferences _prefs;
  final CartModel _model;

  Quote? quote;
  QuoteStatus quoteStatus = QuoteStatus.idle;
  String? quoteErrorCode;
  int _quoteSeq = 0;

  List<CartLine> get lines => _model.lines;
  bool get isEmpty => _model.isEmpty;
  int get itemCount => _model.itemCount;
  CartModel get model => _model;

  void _changed() {
    _prefs.setString(_key, _model.encode());
    quote = null;
    quoteStatus = QuoteStatus.idle;
    quoteErrorCode = null;
    notifyListeners();
  }

  void add(CartLine line) {
    _model.add(line);
    _changed();
  }

  void setQuantity(String key, int q) {
    _model.setQuantity(key, q);
    _changed();
  }

  void remove(String key) {
    _model.remove(key);
    _changed();
  }

  void clear() {
    _model.clear();
    _changed();
  }

  /// Fetches totals from the server. Returns the quote or null on error.
  Future<Quote?> refreshQuote(String locale) async {
    if (_model.isEmpty) {
      quote = null;
      quoteStatus = QuoteStatus.idle;
      notifyListeners();
      return null;
    }
    final seq = ++_quoteSeq;
    quoteStatus = QuoteStatus.loading;
    quoteErrorCode = null;
    notifyListeners();
    try {
      final q = await _api.quote(_model.toQuoteItems(), locale);
      if (seq != _quoteSeq) return null;
      quote = q;
      quoteStatus = QuoteStatus.ready;
      notifyListeners();
      return q;
    } on ApiException catch (e) {
      if (seq != _quoteSeq) return null;
      quote = null;
      quoteStatus = QuoteStatus.error;
      quoteErrorCode = e.code;
      notifyListeners();
      return null;
    }
  }
}

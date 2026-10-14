import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import 'models.dart';

/// Thrown for network or unexpected-response failures. [code] carries the API error code if any.
class ApiException implements Exception {
  ApiException(this.message, {this.code, this.statusCode});
  final String message;
  final String? code;
  final int? statusCode;
  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}

/// Quote errors returned by the API with `ok:false`.
const quoteErrorCodes = {
  'unknown_product',
  'unavailable_product',
  'selling_unit_changed',
  'insufficient_stock',
  'rate_limited',
  'invalid_cart',
};

abstract class StoreApi {
  Future<Catalog> fetchCatalog(String locale);
  Future<Product> fetchProduct(String slug, String locale);

  /// Returns the quote or throws [ApiException] (with [ApiException.code] for API errors).
  Future<Quote> quote(List<QuoteItem> items, String locale);
}

class HttpStoreApi implements StoreApi {
  HttpStoreApi({http.Client? client, String? baseUrl, Duration timeout = const Duration(seconds: 20)})
      : _client = client ?? http.Client(),
        _timeout = timeout,
        _base = baseUrl ?? AppConfig.normalizedBaseUrl;

  final http.Client _client;
  final String _base;
  final Duration _timeout;

  Uri _uri(String path, String locale) =>
      Uri.parse('$_base$path').replace(queryParameters: {'locale': locale});

  Map<String, dynamic> _decode(http.Response res) {
    try {
      final body = jsonDecode(utf8.decode(res.bodyBytes));
      if (body is Map<String, dynamic>) return body;
    } catch (_) {}
    throw ApiException('Invalid response', statusCode: res.statusCode);
  }

  Future<http.Response> _guard(Future<http.Response> f) async {
    try {
      return await f.timeout(_timeout);
    } on TimeoutException {
      throw ApiException('Timeout');
    } catch (e) {
      throw ApiException('Network error: $e');
    }
  }

  @override
  Future<Catalog> fetchCatalog(String locale) async {
    final res = await _guard(
        _client.get(_uri('/api/v1/catalog', locale), headers: {'Accept': 'application/json'}));
    final body = _decode(res);
    if (res.statusCode != 200 || body['ok'] != true) {
      throw ApiException('Catalog failed', code: body['error'] as String?, statusCode: res.statusCode);
    }
    return Catalog.fromJson(body);
  }

  @override
  Future<Product> fetchProduct(String slug, String locale) async {
    final res = await _guard(_client.get(
        _uri('/api/v1/products/${Uri.encodeComponent(slug)}', locale),
        headers: {'Accept': 'application/json'}));
    final body = _decode(res);
    if (res.statusCode != 200 || body['ok'] != true || body['product'] is! Map) {
      throw ApiException('Product failed', code: body['error'] as String?, statusCode: res.statusCode);
    }
    return Product.fromJson((body['product'] as Map).cast<String, dynamic>());
  }

  @override
  Future<Quote> quote(List<QuoteItem> items, String locale) async {
    final res = await _guard(_client.post(
      _uri('/api/v1/cart/quote', locale),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: jsonEncode({'items': items.map((i) => i.toJson()).toList()}),
    ));
    final body = _decode(res);
    if (body['ok'] == true && body['quote'] is Map) {
      return Quote.fromJson((body['quote'] as Map).cast<String, dynamic>());
    }
    final code = body['error'];
    throw ApiException('Quote failed',
        code: code is String && quoteErrorCodes.contains(code) ? code : null,
        statusCode: res.statusCode);
  }
}

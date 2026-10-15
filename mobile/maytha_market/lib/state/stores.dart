import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api_client.dart';
import '../data/models.dart';
import 'dispose_safe.dart';

/// App language; Arabic is the default.
class LocaleStore extends ChangeNotifier {
  LocaleStore(this._prefs) : _code = _prefs.getString(_key) == 'en' ? 'en' : 'ar';
  static const _key = 'locale.v1';
  final SharedPreferences _prefs;
  String _code;

  String get code => _code;
  Locale get locale => Locale(_code);
  bool get isArabic => _code == 'ar';

  void set(String code) {
    if (code == _code || (code != 'ar' && code != 'en')) return;
    _code = code;
    _prefs.setString(_key, code);
    notifyListeners();
  }
}

/// Favorite product ids, stored only on the device.
class FavoritesStore extends ChangeNotifier {
  FavoritesStore(this._prefs) : _ids = {...?_prefs.getStringList(_key)};
  static const _key = 'favorites.v1';
  final SharedPreferences _prefs;
  final Set<String> _ids;

  Set<String> get ids => Set.unmodifiable(_ids);
  bool contains(String id) => _ids.contains(id);

  void toggle(String id) {
    if (!_ids.remove(id)) _ids.add(id);
    _prefs.setStringList(_key, _ids.toList());
    notifyListeners();
  }
}

enum LoadState { loading, ready, error }

/// Catalog for the current locale.
class CatalogStore extends ChangeNotifier with DisposeSafeNotifier {
  CatalogStore(this.api);
  final StoreApi api;

  Catalog? catalog;
  LoadState state = LoadState.loading;
  String? _locale;
  int _seq = 0;

  Future<void> load(String locale, {bool force = false}) async {
    if (!force && locale == _locale && state != LoadState.error) return;
    _locale = locale;
    final seq = ++_seq;
    if (catalog == null || force) state = LoadState.loading;
    notifyListeners();
    try {
      final c = await api.fetchCatalog(locale);
      if (seq != _seq) return;
      catalog = c;
      state = LoadState.ready;
    } catch (_) {
      if (seq != _seq) return;
      state = LoadState.error;
    }
    notifyListeners();
  }

  Future<void> retry() => load(_locale ?? 'ar', force: true);
}

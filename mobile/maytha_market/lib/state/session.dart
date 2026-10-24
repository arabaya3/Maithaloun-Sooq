import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Last meaningful navigation location, persisted so a cold start shortly after
/// the OS killed the process returns the shopper where they were.
///
/// Read-only by design: it only stores where the user was looking (tab,
/// product, variant, catalog filters). It never stores or replays actions —
/// nothing that adds to the cart, quotes or orders is ever restored.
class SessionSnapshot {
  const SessionSnapshot({
    this.tab = 0,
    this.productSlug,
    this.variantId,
    this.query = '',
    this.category,
    this.sort = 'recommended',
    required this.savedAt,
  });

  final int tab;
  final String? productSlug;
  final String? variantId;
  final String query;
  final String? category;
  final String sort;
  final DateTime savedAt;

  Map<String, Object?> toJson() => {
    'tab': tab,
    'productSlug': productSlug,
    'variantId': variantId,
    'query': query,
    'category': category,
    'sort': sort,
    'savedAt': savedAt.millisecondsSinceEpoch,
  };

  static SessionSnapshot? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final saved = raw['savedAt'];
    if (saved is! int) return null;
    final tab = raw['tab'];
    String? str(Object? v) => v is String && v.isNotEmpty ? v : null;
    return SessionSnapshot(
      tab: tab is int && tab >= 0 && tab <= 4 ? tab : 0,
      productSlug: str(raw['productSlug']),
      variantId: str(raw['variantId']),
      query: raw['query'] is String ? raw['query'] as String : '',
      category: str(raw['category']),
      sort: str(raw['sort']) ?? 'recommended',
      savedAt: DateTime.fromMillisecondsSinceEpoch(saved),
    );
  }
}

class SessionStore {
  SessionStore(this._prefs, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  /// How long a saved location stays restorable. Must never go below 10 minutes.
  static const restoreWindow = Duration(minutes: 10);
  static const key = 'session.v1';

  final SharedPreferences _prefs;
  final DateTime Function() _clock;

  void save(SessionSnapshot Function(DateTime now) build) {
    _prefs.setString(key, jsonEncode(build(_clock()).toJson()));
  }

  /// The saved snapshot if it is younger than [restoreWindow]; otherwise clears it.
  SessionSnapshot? restorable() {
    final raw = _prefs.getString(key);
    if (raw == null) return null;
    SessionSnapshot? snap;
    try {
      snap = SessionSnapshot.fromJson(jsonDecode(raw));
    } catch (_) {
      snap = null;
    }
    final age = snap == null ? null : _clock().difference(snap.savedAt);
    if (snap == null || age == null || age.isNegative || age > restoreWindow) {
      _prefs.remove(key);
      return null;
    }
    return snap;
  }
}

/// Build-time configuration. No secrets live here: the store API is public and read-only.
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://www.maytha.app',
  );

  static String get normalizedBaseUrl =>
      apiBaseUrl.endsWith('/') ? apiBaseUrl.substring(0, apiBaseUrl.length - 1) : apiBaseUrl;

  /// Absolute image URL: relative paths are resolved against the API base URL.
  static String resolveUrl(String src, {String? base}) {
    final b = base ?? normalizedBaseUrl;
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    if (src.startsWith('//')) return 'https:$src';
    return src.startsWith('/') ? '$b$src' : '$b/$src';
  }
}

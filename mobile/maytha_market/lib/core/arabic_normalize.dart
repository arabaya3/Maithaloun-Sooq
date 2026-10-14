final RegExp _diacritics = RegExp('[ؐ-ًؚ-ٰٟۖ-ۭ]');
final RegExp _spaces = RegExp(r'\s+');

/// Normalizes text for search: strips Arabic diacritics and tatweel, unifies
/// أ/إ/آ → ا, ة → ه, ى → ي, lower-cases Latin letters and collapses whitespace.
String normalizeForSearch(String input) {
  return input
      .replaceAll(_diacritics, '')
      .replaceAll('ـ', '')
      .replaceAll(RegExp('[أإآ]'), 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll('ى', 'ي')
      .toLowerCase()
      .replaceAll(_spaces, ' ')
      .trim();
}

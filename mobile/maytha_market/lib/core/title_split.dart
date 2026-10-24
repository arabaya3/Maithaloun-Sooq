/// Bold title + grey subtitle for the product page header.
class TitleParts {
  const TitleParts(this.title, this.subtitle);
  final String title;
  final String? subtitle;
}

/// Splits a product name for the product page (deterministic, data-agnostic):
///
/// 1. Split at the LAST spaced dash (" – ", " — " or " - ") that is not inside
///    parentheses. No such dash: the whole name is the title, no subtitle.
/// 2. The part after the dash (usually a size, e.g. "750 مل") is the subtitle.
/// 3. If the part before the dash is long (6+ words), only its first
///    [titleWords] words stay in the title; the remaining words move to the
///    front of the subtitle (so "منعّم ومعطّر الملابس لويال بعدة روائح – 750 مل"
///    becomes "منعّم ومعطّر الملابس لويال" / "بعدة روائح – 750 مل").
///
/// Nothing is ever dropped: title + subtitle always contain every word.
TitleParts splitProductTitle(String name, {int titleWords = 4}) {
  final n = name.trim();
  final re = RegExp(r'\s+[–—-]\s+');
  Match? cut;
  for (final m in re.allMatches(n)) {
    final before = n.substring(0, m.start);
    final open = '('.allMatches(before).length;
    final close = ')'.allMatches(before).length;
    if (open <= close) cut = m;
  }
  if (cut == null) return TitleParts(n, null);
  final head = n.substring(0, cut.start).trim();
  final tail = n.substring(cut.end).trim();
  if (head.isEmpty || tail.isEmpty) return TitleParts(n, null);
  final dash = n.substring(cut.start, cut.end).trim();
  final words = head.split(RegExp(r'\s+'));
  if (words.length >= titleWords + 2) {
    final title = words.take(titleWords).join(' ');
    final rest = words.skip(titleWords).join(' ');
    return TitleParts(title, '$rest $dash $tail');
  }
  return TitleParts(head, tail);
}

/// Variant chip labels without the words every option shares (e.g. the brand
/// "لويال" in front of every scent). Returns the labels unchanged when that
/// would leave any label empty.
List<String> shortOptionLabels(List<String> labels) {
  if (labels.length < 2) return labels;
  final split = [for (final l in labels) l.trim().split(RegExp(r'\s+'))];
  var common = 0;
  while (true) {
    if (split.any((w) => w.length <= common + 1)) break;
    final w = split.first[common];
    if (split.any((s) => s[common] != w)) break;
    common++;
  }
  if (common == 0) return labels;
  return [for (final s in split) s.skip(common).join(' ')];
}

/// Compact chip text for a variant label (the full label stays in the chip's
/// semantics): in Arabic UI a trailing Latin "(Soft Pink)" is dropped when
/// Arabic text remains, and a leading "برائحة"/"رائحة" ("scented") is dropped
/// when more words follow, so "برائحة سوفت بينك (Soft Pink)" shows "سوفت بينك".
String compactOptionLabel(String label, {required bool arabicUi}) {
  var s = label.trim();
  if (arabicUi) {
    final m = RegExp(r'^(.*[؀-ۿ].*?)\s*\([^()؀-ۿ]*\)$').firstMatch(s);
    if (m != null) s = m.group(1)!.trim();
  }
  final words = s.split(RegExp(r'\s+'));
  if (words.length > 1 && (words.first == 'برائحة' || words.first == 'رائحة')) s = words.skip(1).join(' ');
  return s;
}

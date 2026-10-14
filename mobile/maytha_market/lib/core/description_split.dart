/// Result of splitting a product description into the description proper and usage notes.
class DescriptionParts {
  const DescriptionParts(this.description, this.usage);
  final String description;
  final String? usage;
}

const _usageLabels = {'طريقة الاستعمال:', 'الاستعمال:'};

/// Splits [text] at the first line that equals `طريقة الاستعمال:` or `الاستعمال:`.
/// No text is dropped except the label line itself (which becomes the section title).
/// If either side would be empty, everything stays in the description.
DescriptionParts splitDescription(String text) {
  final lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  final at = lines.indexWhere((l) => _usageLabels.contains(l.trim()));
  if (at < 0) return DescriptionParts(text.trim(), null);
  final description = lines.sublist(0, at).join('\n').trim();
  final usage = lines.sublist(at + 1).join('\n').trim();
  if (description.isEmpty || usage.isEmpty) return DescriptionParts(text.trim(), null);
  return DescriptionParts(description, usage);
}

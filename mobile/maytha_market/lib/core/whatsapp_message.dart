import '../data/models.dart';
import 'money.dart';

/// Builds the WhatsApp order message (same wording as the website). Never creates an order.
String buildWhatsAppOrderMessage({
  required Quote quote,
  required bool arabic,
  required String storeUrl,
}) {
  final out = <String>[
    arabic ? 'مرحباً MAYTHA 🌿' : 'Hello MAYTHA 🌿',
    '',
    arabic ? 'بدي أطلب المنتجات التالية:' : "I'd like to order:",
    '',
  ];
  for (var i = 0; i < quote.lines.length; i++) {
    final line = quote.lines[i];
    out.add('${i + 1}. ${line.name}');
    final detail = [line.options, line.unit]
        .whereType<String>()
        .where((s) => s.trim().isNotEmpty)
        .join(' · ');
    if (detail.isNotEmpty) out.add(arabic ? '   النوع: $detail' : '   Option: $detail');
    out.add(arabic ? '   الكمية: ${line.quantity}' : '   Quantity: ${line.quantity}');
    final price = formatAgorot(line.lineSubtotalAgorot);
    out.add(arabic ? '   السعر: $price' : '   Price: $price');
    out.add('');
  }
  out.addAll(arabic
      ? [
          'المجموع: ${formatAgorot(quote.itemsSubtotalAgorot)}',
          'التوصيل: ${formatAgorot(quote.deliveryFeeAgorot)}',
          'الإجمالي: ${formatAgorot(quote.totalAgorot)}',
          'الدفع نقداً عند الاستلام.',
          '',
          'رابط المتجر: $storeUrl',
        ]
      : [
          'Subtotal: ${formatAgorot(quote.itemsSubtotalAgorot)}',
          'Delivery: ${formatAgorot(quote.deliveryFeeAgorot)}',
          'Total: ${formatAgorot(quote.totalAgorot)}',
          'Cash on delivery.',
          '',
          'Store: $storeUrl',
        ]);
  return out.join('\n');
}

/// `https://wa.me/<digits>?text=<encoded>`; null when the number is missing or invalid.
Uri? whatsAppUri(String? e164, [String? message]) {
  if (e164 == null) return null;
  final digits = e164.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 8) return null;
  final q = message == null ? '' : '?text=${Uri.encodeComponent(message)}';
  return Uri.parse('https://wa.me/$digits$q');
}

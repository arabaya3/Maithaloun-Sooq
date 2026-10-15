/// Money is integer agorot (1 ₪ = 100 agorot). Displayed like "12 ₪" or "12.5 ₪".
String formatAgorot(int agorot) {
  final negative = agorot < 0;
  final abs = agorot.abs();
  final whole = abs ~/ 100;
  final cents = abs % 100;
  String text;
  if (cents == 0) {
    text = '$whole';
  } else if (cents % 10 == 0) {
    text = '$whole.${cents ~/ 10}';
  } else {
    text = '$whole.${cents.toString().padLeft(2, '0')}';
  }
  return '${negative ? '-' : ''}$text ₪';
}

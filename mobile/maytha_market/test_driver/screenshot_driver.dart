// Host side of `flutter drive` for store screenshots: writes every screenshot taken by
// integration_test/store_screenshots_test.dart to $SCREENSHOT_DIR (default build/store-screenshots).
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final dir = Directory(Platform.environment['SCREENSHOT_DIR'] ?? 'build/store-screenshots')
    ..createSync(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      File('${dir.path}/$name.png').writeAsBytesSync(bytes);
      return true;
    },
  );
}

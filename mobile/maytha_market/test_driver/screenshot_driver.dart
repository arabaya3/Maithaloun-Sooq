// Host side of `flutter drive` for store screenshots.
//
// The app (integration_test/store_screenshots_test.dart) asks for a screenshot by writing
// `<name>.req` into SHOT_SYNC_DIR (the iOS simulator shares the host file system). This driver
// then captures the whole simulator screen, status bar included, with
// `xcrun simctl io <SIM_UDID> screenshot` into SCREENSHOT_DIR and answers with `<name>.done`.
import 'dart:async';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

Future<void> main() async {
  final env = Platform.environment;
  final udid = env['SIM_UDID'] ?? 'booted';
  final out = Directory(env['SCREENSHOT_DIR'] ?? 'build/store-screenshots')..createSync(recursive: true);
  final sync = Directory(env['SHOT_SYNC_DIR'] ?? '/tmp/maytha-shots');
  if (sync.existsSync()) sync.deleteSync(recursive: true);
  sync.createSync(recursive: true);

  var busy = false;
  final timer = Timer.periodic(const Duration(milliseconds: 250), (_) async {
    if (busy) return;
    busy = true;
    try {
      for (final f in sync.listSync().whereType<File>().where((f) => f.path.endsWith('.req'))) {
        final name = f.uri.pathSegments.last.replaceAll('.req', '');
        final r = await Process.run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', '${out.path}/$name.png']);
        stdout.writeln('screenshot $name: exit ${r.exitCode} ${r.stderr}');
        f.deleteSync();
        File('${sync.path}/$name.done').writeAsStringSync('${r.exitCode}');
      }
    } finally {
      busy = false;
    }
  });
  try {
    await integrationDriver();
  } finally {
    timer.cancel();
  }
}

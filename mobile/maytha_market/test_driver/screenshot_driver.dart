// Host side of `flutter drive` for store screenshots.
//
// The app (integration_test/store_screenshots_test.dart) asks for a screenshot by writing
// `<name>.req` into SHOT_SYNC_DIR (the iOS simulator shares the host file system). This driver
// then captures the whole simulator screen, status bar included, with
// `xcrun simctl io <SIM_UDID> screenshot` into SCREENSHOT_DIR and answers with `<name>.done`.
import 'dart:async';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

/// `simctl io screenshot` occasionally stalls on a busy CI runner. Each attempt is cut off after
/// 40 seconds and retried, up to three times, so the app always gets an answer.
Future<int> capture(String udid, String path, String name) async {
  var code = -1;
  for (var attempt = 1; attempt <= 3; attempt++) {
    final process = await Process.start('xcrun', [
      'simctl',
      'io',
      udid,
      'screenshot',
      '--type=png',
      path,
    ]);
    final stderrText = process.stderr
        .transform(const SystemEncoding().decoder)
        .join();
    code = await process.exitCode.timeout(
      const Duration(seconds: 40),
      onTimeout: () {
        process.kill(ProcessSignal.sigkill);
        return -1;
      },
    );
    stdout.writeln(
      'screenshot $name (attempt $attempt): exit $code ${await stderrText.timeout(const Duration(seconds: 2), onTimeout: () => '')}',
    );
    if (code == 0) break;
  }
  return code;
}

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
        f.deleteSync();
        final code = await capture(udid, '${out.path}/$name.png', name);
        File('${sync.path}/$name.done').writeAsStringSync('$code');
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

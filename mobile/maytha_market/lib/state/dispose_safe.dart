import 'package:flutter/foundation.dart';

/// For stores that notify after awaiting the network: if the store was disposed while the
/// request was in flight (the screen or the app tree went away), the late result is dropped
/// instead of throwing "used after being disposed".
mixin DisposeSafeNotifier on ChangeNotifier {
  bool _disposed = false;

  bool get isDisposed => _disposed;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }
}

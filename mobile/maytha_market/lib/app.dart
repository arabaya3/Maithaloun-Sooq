import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'data/api_client.dart';
import 'l10n/gen/app_localizations.dart';
import 'state/cart.dart';
import 'state/session.dart';
import 'state/stores.dart';
import 'ui/screens/shell.dart';
import 'ui/screens/product_screen.dart';
import 'ui/theme.dart';

/// Extracts a product slug from `maytha://product/<slug>` or `https://<host>/[ar|en/]products/<slug>`.
String? slugFromDeepLink(Uri uri) {
  if (uri.scheme == 'maytha' && uri.host == 'product') {
    final segs = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    return segs.isEmpty ? null : segs.first;
  }
  if (uri.scheme == 'http' || uri.scheme == 'https') {
    final segs = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    final i = segs.indexOf('products');
    if (i >= 0 && i + 1 < segs.length) return segs[i + 1];
  }
  return null;
}

class MaythaApp extends StatelessWidget {
  const MaythaApp({super.key, required this.prefs, required this.api, this.enableDeepLinks = true});
  final SharedPreferences prefs;
  final StoreApi api;
  final bool enableDeepLinks;

  @override
  Widget build(BuildContext context) {
    final session = SessionStore(prefs);
    return MultiProvider(
      providers: [
        Provider<StoreApi>.value(value: api),
        Provider<SessionStore>.value(value: session),
        ChangeNotifierProvider(create: (_) => LocaleStore(prefs)),
        ChangeNotifierProvider(create: (_) => FavoritesStore(prefs)),
        ChangeNotifierProvider(create: (_) => CatalogStore(api)),
        ChangeNotifierProvider(create: (_) => CartStore(api, prefs)),
        ChangeNotifierProvider(create: (_) => ShellController(session: session)),
      ],
      child: _AppView(enableDeepLinks: enableDeepLinks),
    );
  }
}

class _AppView extends StatefulWidget {
  const _AppView({required this.enableDeepLinks});
  final bool enableDeepLinks;
  @override
  State<_AppView> createState() => _AppViewState();
}

class _AppViewState extends State<_AppView> with WidgetsBindingObserver {
  final _navKey = GlobalKey<NavigatorState>();
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<Uri>? _linkSub;
  SessionSnapshot? _pendingRestore;
  CatalogStore? _catalogStore;
  LocaleStore? _localeStore;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Cold start: restore the last location if it is recent enough. Only
    // navigation state is restored; nothing is submitted or ordered.
    final snap = context.read<SessionStore>().restorable();
    if (snap != null) {
      context.read<ShellController>().restore(snap);
      if (snap.productSlug != null) _pendingRestore = snap;
    }
    if (widget.enableDeepLinks) {
      // app_links delivers the initial link through the stream as well.
      _linkSub = AppLinks().uriLinkStream.listen(_openLink, onError: (_) {});
    }
    final localeStore = context.read<LocaleStore>();
    final catalogStore = _catalogStore = context.read<CatalogStore>();
    _localeStore = localeStore;
    localeStore.addListener(_loadCatalog);
    if (_pendingRestore != null) catalogStore.addListener(_tryRestoreProduct);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadCatalog());
  }

  void _loadCatalog() => _catalogStore?.load(_localeStore!.code);

  /// Re-opens the restored product once fresh catalog data confirms it still exists.
  ///
  /// Only a successfully loaded catalog that genuinely lacks the product means
  /// "no longer available". A failed load (offline, timeout, server error)
  /// keeps the snapshot and keeps listening: the normal error/retry state is
  /// shown and the product opens as soon as a retry succeeds.
  void _tryRestoreProduct() {
    if (!mounted) return;
    final snap = _pendingRestore;
    final store = _catalogStore!;
    if (snap == null || store.state != LoadState.ready || store.catalog == null) return;
    _pendingRestore = null;
    store.removeListener(_tryRestoreProduct);
    final shell = context.read<ShellController>();
    final product = store.catalog!.bySlug(snap.productSlug!);
    if (product != null) {
      _navKey.currentState?.push(
        MaterialPageRoute(
          settings: RouteSettings(name: '/product/${product.slug}'),
          builder: (_) => ProductScreen(slug: product.slug, initialVariantId: snap.variantId),
        ),
      );
      return;
    }
    // The catalog loaded successfully and genuinely lacks the product.
    shell.productClosed(snap.productSlug!);
    shell.go(0);
    {
      final ctx = _navKey.currentContext;
      if (ctx != null) {
        _messengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(ctx).restoreProductMissing)),
        );
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      context.read<ShellController>().persist();
    }
  }

  void _openLink(Uri uri) {
    final slug = slugFromDeepLink(uri);
    if (slug == null) return;
    _navKey.currentState?.push(
      MaterialPageRoute(
        settings: RouteSettings(name: '/product/$slug'),
        builder: (_) => ProductScreen(slug: slug),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _localeStore?.removeListener(_loadCatalog);
    _catalogStore?.removeListener(_tryRestoreProduct);
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleStore>();
    return MaterialApp(
      navigatorKey: _navKey,
      scaffoldMessengerKey: _messengerKey,
      title: 'MAYTHA MARKET',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: locale.locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      // Respect the system font size up to kMaxTextScale (2.0, see theme.dart).
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(textScaler: mq.textScaler.clamp(maxScaleFactor: kMaxTextScale)),
          child: child!,
        );
      },
      home: const AppShell(),
    );
  }
}

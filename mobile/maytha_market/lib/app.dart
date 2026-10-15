import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'data/api_client.dart';
import 'l10n/gen/app_localizations.dart';
import 'state/cart.dart';
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
    return MultiProvider(
      providers: [
        Provider<StoreApi>.value(value: api),
        ChangeNotifierProvider(create: (_) => LocaleStore(prefs)),
        ChangeNotifierProvider(create: (_) => FavoritesStore(prefs)),
        ChangeNotifierProvider(create: (_) => CatalogStore(api)),
        ChangeNotifierProvider(create: (_) => CartStore(api, prefs)),
        ChangeNotifierProvider(create: (_) => ShellController()),
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

class _AppViewState extends State<_AppView> {
  final _navKey = GlobalKey<NavigatorState>();
  StreamSubscription<Uri>? _linkSub;

  @override
  void initState() {
    super.initState();
    if (widget.enableDeepLinks) {
      // app_links delivers the initial link through the stream as well.
      _linkSub = AppLinks().uriLinkStream.listen(_openLink, onError: (_) {});
    }
    final localeStore = context.read<LocaleStore>();
    void loadCatalog() => context.read<CatalogStore>().load(localeStore.code);
    localeStore.addListener(loadCatalog);
    WidgetsBinding.instance.addPostFrameCallback((_) => loadCatalog());
  }

  void _openLink(Uri uri) {
    final slug = slugFromDeepLink(uri);
    if (slug == null) return;
    _navKey.currentState?.push(MaterialPageRoute(builder: (_) => ProductScreen(slug: slug)));
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleStore>();
    return MaterialApp(
      navigatorKey: _navKey,
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
      home: const AppShell(),
    );
  }
}

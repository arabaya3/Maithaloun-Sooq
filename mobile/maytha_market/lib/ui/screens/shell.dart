import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../state/cart.dart';
import '../../state/session.dart';
import 'cart_screen.dart';
import 'catalog_screen.dart';
import 'favorites_screen.dart';
import 'home_screen.dart';
import 'product_screen.dart';
import 'settings_screen.dart';

/// Bottom-navigation state plus the "where am I" facts that session
/// restoration persists (tab, catalog filters, open product + variant).
class ShellController extends ChangeNotifier {
  ShellController({this.session});
  final SessionStore? session;

  int index = 0;
  String? pendingCategory;
  int categoryRequest = 0;
  int searchFocusRequest = 0;

  String catalogQuery = '';
  String? catalogCategory;
  String catalogSort = 'recommended';
  String? productSlug;
  String? variantId;

  void go(int i) {
    if (i == index) return;
    index = i;
    persist();
    notifyListeners();
  }

  void openCatalog({String? category, bool focusSearch = false}) {
    pendingCategory = category;
    categoryRequest++;
    if (focusSearch) searchFocusRequest++;
    index = 1;
    persist();
    notifyListeners();
  }

  /// Called by the catalog screen whenever search/filter/sort change.
  void updateCatalog({required String query, required String? category, required String sort}) {
    catalogQuery = query;
    catalogCategory = category;
    catalogSort = sort;
    persist();
  }

  void productOpened(String slug, String? variant) {
    productSlug = slug;
    variantId = variant;
    persist();
  }

  void productClosed(String slug) {
    if (productSlug != slug) return;
    productSlug = null;
    variantId = null;
    persist();
  }

  /// Applies a restored snapshot (before the first frame of the shell).
  void restore(SessionSnapshot s) {
    index = s.tab;
    catalogQuery = s.query;
    catalogCategory = s.category;
    catalogSort = s.sort;
    // Keep the product in the persisted snapshot until restoration resolves,
    // so a failed catalog load (or a tab change meanwhile) does not drop it.
    productSlug = s.productSlug;
    variantId = s.variantId;
  }

  void persist() {
    session?.save(
      (now) => SessionSnapshot(
        tab: index,
        productSlug: productSlug,
        variantId: variantId,
        query: catalogQuery,
        category: catalogCategory,
        sort: catalogSort,
        savedAt: now,
      ),
    );
  }
}

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final shell = context.watch<ShellController>();
    final count = context.select<CartStore, int>((c) => c.itemCount);
    Widget cartIcon(IconData icon) => Badge(isLabelVisible: count > 0, label: Text('$count'), child: Icon(icon));
    return Scaffold(
      body: IndexedStack(
        index: shell.index,
        children: const [HomeScreen(), CatalogScreen(), FavoritesScreen(), CartScreen(), SettingsScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.index,
        onDestinationSelected: shell.go,
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home_outlined),
            selectedIcon: const Icon(Icons.home),
            label: l.navHome,
          ),
          NavigationDestination(
            icon: const Icon(Icons.storefront_outlined),
            selectedIcon: const Icon(Icons.storefront),
            label: l.navCatalog,
          ),
          NavigationDestination(
            icon: const Icon(Icons.favorite_border),
            selectedIcon: const Icon(Icons.favorite),
            label: l.navFavorites,
          ),
          NavigationDestination(
            icon: cartIcon(Icons.shopping_bag_outlined),
            selectedIcon: cartIcon(Icons.shopping_bag),
            label: l.navCart,
          ),
          NavigationDestination(
            icon: const Icon(Icons.settings_outlined),
            selectedIcon: const Icon(Icons.settings),
            label: l.navSettings,
          ),
        ],
      ),
    );
  }
}

void openProduct(BuildContext context, String slug, {String? variantId}) {
  Navigator.of(context).push(
    MaterialPageRoute(
      settings: RouteSettings(name: '/product/$slug'),
      builder: (_) => ProductScreen(slug: slug, initialVariantId: variantId),
    ),
  );
}

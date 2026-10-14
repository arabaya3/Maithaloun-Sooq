import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../state/cart.dart';
import 'cart_screen.dart';
import 'catalog_screen.dart';
import 'favorites_screen.dart';
import 'home_screen.dart';
import 'product_screen.dart';
import 'settings_screen.dart';

/// Bottom-navigation state; lets Home jump to Shop with a category preselected.
class ShellController extends ChangeNotifier {
  int index = 0;
  String? pendingCategory;
  int categoryRequest = 0;

  void go(int i) {
    if (i == index) return;
    index = i;
    notifyListeners();
  }

  void openCatalog({String? category}) {
    pendingCategory = category;
    categoryRequest++;
    index = 1;
    notifyListeners();
  }
}

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final shell = context.watch<ShellController>();
    final count = context.select<CartStore, int>((c) => c.itemCount);
    return Scaffold(
      body: IndexedStack(index: shell.index, children: const [
        HomeScreen(),
        CatalogScreen(),
        FavoritesScreen(),
        CartScreen(),
        SettingsScreen(),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.index,
        onDestinationSelected: shell.go,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: l.navHome),
          NavigationDestination(icon: const Icon(Icons.search), label: l.navCatalog),
          NavigationDestination(
              icon: const Icon(Icons.favorite_border), selectedIcon: const Icon(Icons.favorite), label: l.navFavorites),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: count > 0,
              label: Text('$count'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: count > 0,
              label: Text('$count'),
              child: const Icon(Icons.shopping_bag),
            ),
            label: l.navCart,
          ),
          NavigationDestination(
              icon: const Icon(Icons.settings_outlined), selectedIcon: const Icon(Icons.settings), label: l.navSettings),
        ],
      ),
    );
  }
}

void openProduct(BuildContext context, String slug) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(slug: slug)));
}

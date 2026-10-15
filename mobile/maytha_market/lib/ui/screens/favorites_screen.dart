import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../widgets/common.dart';
import 'shell.dart';

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final store = context.watch<CatalogStore>();
    final favs = context.watch<FavoritesStore>().ids;
    final catalog = store.catalog;
    return Scaffold(
      appBar: AppBar(title: Text(l.navFavorites)),
      body: Builder(builder: (context) {
        if (catalog == null) {
          return store.state == LoadState.error
              ? ErrorView(message: l.loadError, onRetry: store.retry)
              : const LoadingView();
        }
        final products = catalog.products.where((p) => favs.contains(p.id)).toList();
        if (products.isEmpty) {
          return EmptyView(
            icon: Icons.favorite_border,
            message: l.favoritesEmpty,
            action: OutlinedButton(
              onPressed: () => context.read<ShellController>().openCatalog(),
              child: Text(l.browseProducts),
            ),
          );
        }
        return CustomScrollView(slivers: [
          ProductSliverGrid(products: products, onOpen: (p) => openProduct(context, p.slug)),
        ]);
      }),
    );
  }
}

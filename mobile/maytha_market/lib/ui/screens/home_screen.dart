import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/cart.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final store = context.watch<CatalogStore>();
    final catalog = store.catalog;
    final count = context.select<CartStore, int>((c) => c.itemCount);
    final shell = context.read<ShellController>();
    return Scaffold(
      appBar: AppBar(
        title: const BrandHeader(),
        actions: [
          IconButton(
            tooltip: l.navCart,
            onPressed: () => shell.go(3),
            icon: Badge(
              isLabelVisible: count > 0,
              label: Text('$count'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Builder(
        builder: (context) {
          if (catalog == null) {
            if (store.state == LoadState.error) {
              return ErrorView(message: l.loadError, onRetry: store.retry);
            }
            return const LoadingView();
          }
          if (catalog.products.isEmpty) {
            return EmptyView(
              icon: Icons.inventory_2_outlined,
              message: l.catalogEmpty,
              action: OutlinedButton.icon(
                onPressed: store.retry,
                icon: const Icon(Icons.refresh),
                label: Text(l.retry),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: store.retry,
            child: CustomScrollView(
              slivers: [
                const SliverToBoxAdapter(child: _SearchEntry()),
                const SliverToBoxAdapter(child: _Hero()),
                if (catalog.categories.isNotEmpty) ...[
                  _SectionTitle(l.categories),
                  SliverToBoxAdapter(child: _CategoryStrip(catalog: catalog)),
                ],
                _SectionTitle(
                  l.products,
                  action: TextButton(onPressed: () => shell.openCatalog(), child: Text(l.seeAll)),
                ),
                ProductSliverGrid(products: catalog.products, onOpen: (p) => openProduct(context, p.slug)),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Tappable search field that jumps to the catalog with the keyboard open.
class _SearchEntry extends StatelessWidget {
  const _SearchEntry();
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Semantics(
        button: true,
        label: l.searchHint,
        child: ExcludeSemantics(
          child: Material(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Radii.md),
              side: const BorderSide(color: BrandColors.hairline),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(Radii.md),
              onTap: () => context.read<ShellController>().openCatalog(focusSearch: true),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Row(
                  children: [
                    const Icon(Icons.search, size: 20, color: BrandColors.muted),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        l.searchHint,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: t.bodyMedium?.copyWith(color: BrandColors.muted),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact promo banner: headline (max 2 lines), subtitle, one action.
class _Hero extends StatelessWidget {
  const _Hero();
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        decoration: BoxDecoration(color: BrandColors.forest, borderRadius: BorderRadius.circular(Radii.lg)),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l.heroHeadline,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.titleMedium?.copyWith(color: Colors.white, height: 1.35),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    l.heroSubtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.bodySmall?.copyWith(color: BrandColors.leafOnDark),
                  ),
                  const SizedBox(height: 10),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: BrandColors.forest,
                      minimumSize: const Size(0, 40),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      textStyle: t.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    onPressed: () => context.read<ShellController>().openCatalog(),
                    child: Text(l.shopNow),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            ExcludeSemantics(
              child: Container(
                width: 64,
                height: 64,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: BrandColors.ivory, borderRadius: BorderRadius.circular(Radii.md)),
                child: const BrandMark(height: 40),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {this.action});
  final String text;
  final Widget? action;
  @override
  Widget build(BuildContext context) => SliverToBoxAdapter(
    child: Padding(
      padding: EdgeInsetsDirectional.fromSTEB(16, 14, action == null ? 16 : 4, 6),
      child: Row(
        children: [
          Expanded(
            child: Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleMedium)),
          ),
          ?action,
        ],
      ),
    ),
  );
}

/// Category tiles: image + full name on up to two lines. Height follows the text scale
/// (the old strip was a fixed 112dp with a one-line label, which truncated names).
class _CategoryStrip extends StatelessWidget {
  const _CategoryStrip({required this.catalog});
  final Catalog catalog;

  static const _tile = 88.0;
  static const _image = 60.0;
  static const _labelSize = 12.5;
  static const _labelHeight = 1.3;

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    final labelBlock = 2 * scaler.scale(_labelSize) * _labelHeight;
    final t = Theme.of(context).textTheme;
    return SizedBox(
      height: _image + 6 + labelBlock + 8,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        scrollDirection: Axis.horizontal,
        itemCount: catalog.categories.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, i) {
          final c = catalog.categories[i];
          ProductImage? img;
          for (final p in catalog.products) {
            if (p.categoryCode == c.code && p.image != null) {
              img = p.image;
              break;
            }
          }
          return Semantics(
            button: true,
            label: c.name,
            child: ExcludeSemantics(
              child: InkWell(
                borderRadius: BorderRadius.circular(Radii.md),
                onTap: () => context.read<ShellController>().openCatalog(category: c.code),
                child: SizedBox(
                  width: _tile,
                  child: Column(
                    children: [
                      Container(
                        width: _image,
                        height: _image,
                        padding: const EdgeInsets.all(6),
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(Radii.md),
                          border: Border.all(color: BrandColors.hairline),
                        ),
                        child: NetImage(image: img, fit: BoxFit.contain),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        c.name,
                        maxLines: 2,
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                        strutStyle: const StrutStyle(
                          fontSize: _labelSize,
                          height: _labelHeight,
                          forceStrutHeight: true,
                        ),
                        style: t.labelMedium?.copyWith(fontSize: _labelSize, height: _labelHeight),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

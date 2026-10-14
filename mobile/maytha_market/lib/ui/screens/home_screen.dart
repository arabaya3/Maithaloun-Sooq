import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

class BrandHeader extends StatelessWidget {
  const BrandHeader({super.key});
  @override
  Widget build(BuildContext context) => Semantics(
        header: true,
        label: 'MAYTHA MARKET',
        child: ExcludeSemantics(
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Monogram(size: 34),
            const SizedBox(width: 10),
            Text('MAYTHA MARKET',
                textDirection: TextDirection.ltr,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800, letterSpacing: 2.2, color: BrandColors.forest)),
          ]),
        ),
      );
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final store = context.watch<CatalogStore>();
    final catalog = store.catalog;
    return Scaffold(
      appBar: AppBar(title: const BrandHeader(), toolbarHeight: 64),
      body: Builder(builder: (context) {
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
                onPressed: store.retry, icon: const Icon(Icons.refresh), label: Text(l.retry)),
          );
        }
        return RefreshIndicator(
          onRefresh: store.retry,
          child: CustomScrollView(slivers: [
            const SliverToBoxAdapter(child: _Hero()),
            if (catalog.categories.isNotEmpty) ...[
              _SectionTitle(l.categories),
              SliverToBoxAdapter(child: _CategoryStrip(catalog: catalog)),
            ],
            _SectionTitle(l.products,
                action: TextButton(
                    onPressed: () => context.read<ShellController>().openCatalog(), child: Text(l.seeAll))),
            ProductSliverGrid(products: catalog.products, onOpen: (p) => openProduct(context, p.slug)),
          ]),
        );
      }),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: BrandColors.forest,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.heroHeadline,
                  style: t.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700, height: 1.35)),
              const SizedBox(height: 8),
              Text(l.heroSubtitle, style: t.bodySmall?.copyWith(color: BrandColors.sage)),
              const SizedBox(height: 14),
              FilledButton(
                style: FilledButton.styleFrom(
                    backgroundColor: BrandColors.ivory, foregroundColor: BrandColors.forest),
                onPressed: () => context.read<ShellController>().openCatalog(),
                child: Text(l.shopNow),
              ),
            ]),
          ),
          const SizedBox(width: 12),
          const ExcludeSemantics(child: Monogram(size: 72, onDark: true)),
        ]),
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
          padding: const EdgeInsets.fromLTRB(16, 16, 8, 4),
          child: Row(children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(text,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              ),
            ),
            ?action,
          ]),
        ),
      );
}

class _CategoryStrip extends StatelessWidget {
  const _CategoryStrip({required this.catalog});
  final Catalog catalog;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 112,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        itemCount: catalog.categories.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
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
                borderRadius: BorderRadius.circular(16),
                onTap: () => context.read<ShellController>().openCatalog(category: c.code),
                child: SizedBox(
                  width: 84,
                  child: Column(children: [
                    Container(
                      width: 72,
                      height: 72,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: BrandColors.hairline),
                      ),
                      child: NetImage(image: img),
                    ),
                    const SizedBox(height: 6),
                    Text(c.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelMedium),
                  ]),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

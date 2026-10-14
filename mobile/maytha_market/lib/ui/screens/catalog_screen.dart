import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/arabic_normalize.dart';
import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../widgets/common.dart';
import 'shell.dart';

enum SortMode { recommended, priceLow, priceHigh }

/// Filters and sorts products; pure function for testing.
List<Product> filterProducts(
  List<Product> products, {
  String query = '',
  String? category,
  SortMode sort = SortMode.recommended,
}) {
  final q = normalizeForSearch(query);
  final terms = q.isEmpty ? const <String>[] : q.split(' ');
  final out = products.where((p) {
    if (category != null && p.categoryCode != category) return false;
    if (terms.isEmpty) return true;
    final hay = normalizeForSearch('${p.name} ${p.nameAr} ${p.brand ?? ''}');
    return terms.every(hay.contains);
  }).toList();
  switch (sort) {
    case SortMode.recommended:
      break;
    case SortMode.priceLow:
      out.sort((a, b) => a.priceAgorot.compareTo(b.priceAgorot));
    case SortMode.priceHigh:
      out.sort((a, b) => b.priceAgorot.compareTo(a.priceAgorot));
  }
  return out;
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});
  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  final _search = TextEditingController();
  String? _category;
  SortMode _sort = SortMode.recommended;
  int _seenRequest = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final shell = context.watch<ShellController>();
    if (shell.categoryRequest != _seenRequest) {
      _seenRequest = shell.categoryRequest;
      _category = shell.pendingCategory;
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final store = context.watch<CatalogStore>();
    final catalog = store.catalog;
    return Scaffold(
      appBar: AppBar(title: Text(l.navCatalog)),
      body: Builder(builder: (context) {
        if (catalog == null) {
          return store.state == LoadState.error
              ? ErrorView(message: l.loadError, onRetry: store.retry)
              : const LoadingView();
        }
        final results = filterProducts(catalog.products, query: _search.text, category: _category, sort: _sort);
        return CustomScrollView(slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: l.searchHint,
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: l.close,
                              icon: const Icon(Icons.clear),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                PopupMenuButton<SortMode>(
                  tooltip: l.sortLabel,
                  icon: const Icon(Icons.sort),
                  initialValue: _sort,
                  onSelected: (s) => setState(() => _sort = s),
                  itemBuilder: (_) => [
                    PopupMenuItem(value: SortMode.recommended, child: Text(l.sortRecommended)),
                    PopupMenuItem(value: SortMode.priceLow, child: Text(l.sortPriceLow)),
                    PopupMenuItem(value: SortMode.priceHigh, child: Text(l.sortPriceHigh)),
                  ],
                ),
              ]),
            ),
          ),
          SliverToBoxAdapter(
            child: SizedBox(
              height: 52,
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                children: [
                  _chip(l.allCategories, _category == null, () => setState(() => _category = null)),
                  for (final c in catalog.categories)
                    _chip(c.name, _category == c.code, () => setState(() => _category = c.code)),
                ],
              ),
            ),
          ),
          if (results.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyView(
                  icon: Icons.search_off,
                  message: catalog.products.isEmpty ? l.catalogEmpty : l.noResults),
            )
          else
            ProductSliverGrid(products: results, onOpen: (p) => openProduct(context, p.slug)),
        ]);
      }),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap()),
      );
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/description_split.dart';
import '../../core/money.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/cart.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

class ProductScreen extends StatefulWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;
  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  Product? _fetched;
  bool _loading = false;
  bool _failed = false;
  String? _fetchedLocale;

  Future<void> _fetch(String locale) async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final p = await context.read<StoreApi>().fetchProduct(widget.slug, locale);
      if (!mounted) return;
      setState(() {
        _fetched = p;
        _fetchedLocale = locale;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
        _fetchedLocale = locale;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final locale = context.watch<LocaleStore>().code;
    final store = context.watch<CatalogStore>();
    final fromCatalog = store.catalog?.bySlug(widget.slug);
    final product = fromCatalog ?? (_fetchedLocale == locale ? _fetched : null);

    if (product == null && !_loading && _fetchedLocale != locale && store.state != LoadState.loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_loading) _fetch(locale);
      });
    }

    Widget body;
    if (product != null) {
      body = _ProductBody(key: ValueKey('${product.id}-$locale'), product: product);
    } else if (_failed) {
      body = ErrorView(message: l.productNotFound, onRetry: () => _fetch(locale));
    } else {
      body = const LoadingView();
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(product?.name ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [if (product != null) FavoriteButton(productId: product.id)],
      ),
      body: body,
    );
  }
}

class _ProductBody extends StatefulWidget {
  const _ProductBody({super.key, required this.product});
  final Product product;
  @override
  State<_ProductBody> createState() => _ProductBodyState();
}

class _ProductBodyState extends State<_ProductBody> {
  final _pager = PageController();
  int _page = 0;
  Variant? _variant;
  SellingUnit? _unit;
  int _qty = 1;

  @override
  void initState() {
    super.initState();
    _variant = widget.product.defaultVariant;
    _unit = _variant?.defaultUnit;
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  void _selectVariant(Variant v) {
    setState(() {
      _variant = v;
      _unit = v.defaultUnit;
      _qty = 1;
    });
    final img = v.image;
    if (img != null) {
      final i = widget.product.gallery.indexWhere((g) => g.src == img.src);
      if (i >= 0 && _pager.hasClients) {
        _pager.animateToPage(i, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    }
  }

  void _addToCart() {
    final l = AppLocalizations.of(context);
    final p = widget.product;
    final v = _variant!;
    final u = _unit!;
    context.read<CartStore>().add(CartLine(
          productId: p.id,
          slug: p.slug,
          name: p.name,
          variantId: v.id,
          variantLabel: p.variants.length > 1 ? v.label : '',
          sellingUnitId: u.id,
          unitLabel: v.sellingUnits.length > 1 ? u.label : '',
          unitsPerSale: u.unitsPerSale,
          unitPriceAgorot: u.priceAgorot,
          maxQuantity: u.maxQuantity,
          quantity: _qty,
          imageSrc: (v.image ?? p.image)?.src,
        ));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(l.addedToCart),
        action: SnackBarAction(
          label: l.viewCart,
          textColor: BrandColors.sage,
          onPressed: () {
            Navigator.of(context).popUntil((r) => r.isFirst);
            context.read<ShellController>().go(3);
          },
        ),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final p = widget.product;
    final gallery = p.gallery;
    final v = _variant;
    final u = _unit;
    final canBuy = p.available && v != null && v.available && u != null && u.maxQuantity > 0;
    final price = u?.priceAgorot ?? p.priceAgorot;
    final parts = p.description == null ? null : splitDescription(p.description!);
    final usage = [
      if (parts?.usage != null) parts!.usage!,
      if (p.usageNotes != null && p.usageNotes!.trim().isNotEmpty) p.usageNotes!.trim(),
    ].join('\n\n');

    return Column(children: [
      Expanded(
        child: ListView(children: [
          AspectRatio(
            aspectRatio: 1,
            child: gallery.isEmpty
                ? const NetImage(image: null)
                : Stack(children: [
                    PageView.builder(
                      controller: _pager,
                      itemCount: gallery.length,
                      onPageChanged: (i) => setState(() => _page = i),
                      itemBuilder: (context, i) => Semantics(
                        button: true,
                        label: l.imageOf(i + 1, gallery.length),
                        child: GestureDetector(
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            fullscreenDialog: true,
                            builder: (_) => ImageViewer(images: gallery, initial: i),
                          )),
                          child: ColoredBox(
                              color: Colors.white, child: NetImage(image: gallery[i], fit: BoxFit.contain)),
                        ),
                      ),
                    ),
                    if (gallery.length > 1)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 10,
                        child: PageDots(count: gallery.length, index: _page),
                      ),
                  ]),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (p.brand != null && p.brand!.isNotEmpty)
                Text(p.brand!, style: t.labelLarge?.copyWith(color: BrandColors.muted)),
              Text(p.name, style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Row(children: [
                Text(formatAgorot(price),
                    textDirection: TextDirection.ltr,
                    style: t.titleLarge?.copyWith(color: BrandColors.forest, fontWeight: FontWeight.w800)),
                const SizedBox(width: 12),
                if (!canBuy)
                  Chip(label: Text(l.outOfStock), visualDensity: VisualDensity.compact),
                if (v?.offer != null)
                  Chip(
                      label: Text(l.offerLabel),
                      backgroundColor: BrandColors.sage,
                      visualDensity: VisualDensity.compact),
              ]),
              if (p.variants.length > 1) ...[
                const SizedBox(height: 16),
                Text(l.option, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final variant in p.variants)
                    ChoiceChip(
                      label: Text(variant.label),
                      selected: variant.id == v?.id,
                      onSelected: variant.available ? (_) => _selectVariant(variant) : null,
                    ),
                ]),
              ],
              if (v != null && v.sellingUnits.length > 1) ...[
                const SizedBox(height: 16),
                Text(l.sellingUnit, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final unit in v.sellingUnits)
                    ChoiceChip(
                      label: Text('${unit.label} · ${formatAgorot(unit.priceAgorot)}'),
                      selected: unit.id == u?.id,
                      onSelected: (_) => setState(() {
                        _unit = unit;
                        _qty = _qty.clamp(1, unit.maxQuantity < 1 ? 1 : unit.maxQuantity);
                      }),
                    ),
                ]),
              ],
              if (canBuy) ...[
                const SizedBox(height: 16),
                Text(l.quantity, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                QuantityStepper(value: _qty, max: u.maxQuantity, onChanged: (q) => setState(() => _qty = q)),
              ],
              if (parts != null && parts.description.isNotEmpty) ...[
                const SizedBox(height: 20),
                _TextSection(title: l.description, body: parts.description),
              ],
              if (usage.isNotEmpty) ...[
                const SizedBox(height: 12),
                _TextSection(title: l.howToUse, body: usage),
              ],
            ]),
          ),
        ]),
      ),
      SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: BrandColors.hairline)),
          ),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: canBuy ? _addToCart : null,
              icon: const Icon(Icons.add_shopping_cart),
              label: Text(canBuy ? '${l.addToCart} · ${formatAgorot(price * _qty)}' : l.outOfStock),
            ),
          ),
        ),
      ),
    ]);
  }
}

class _TextSection extends StatelessWidget {
  const _TextSection({required this.title, required this.body});
  final String title;
  final String body;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Semantics(header: true, child: Text(title, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
          const SizedBox(height: 8),
          SelectableText(body, style: t.bodyMedium?.copyWith(height: 1.6)),
        ]),
      ),
    );
  }
}

class PageDots extends StatelessWidget {
  const PageDots({super.key, required this.count, required this.index, this.onDark = false});
  final int count;
  final int index;
  final bool onDark;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Semantics(
      label: l.imageOf(index + 1, count),
      child: ExcludeSemantics(
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 0; i < count; i++)
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: i == index ? 18 : 7,
              height: 7,
              decoration: BoxDecoration(
                color: i == index
                    ? (onDark ? Colors.white : BrandColors.forest)
                    : (onDark ? Colors.white38 : BrandColors.hairline),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
        ]),
      ),
    );
  }
}

/// Full-screen gallery with pinch-to-zoom.
class ImageViewer extends StatefulWidget {
  const ImageViewer({super.key, required this.images, required this.initial});
  final List<ProductImage> images;
  final int initial;
  @override
  State<ImageViewer> createState() => _ImageViewerState();
}

class _ImageViewerState extends State<ImageViewer> {
  late final PageController _c = PageController(initialPage: widget.initial);
  late int _i = widget.initial;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: BrandColors.deepGreen,
      appBar: AppBar(
        backgroundColor: BrandColors.deepGreen,
        foregroundColor: Colors.white,
        leading: IconButton(
          tooltip: l.close,
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Stack(children: [
        PageView.builder(
          controller: _c,
          itemCount: widget.images.length,
          onPageChanged: (i) => setState(() => _i = i),
          itemBuilder: (_, i) => InteractiveViewer(
            minScale: 1,
            maxScale: 5,
            child: Center(child: NetImage(image: widget.images[i], fit: BoxFit.contain)),
          ),
        ),
        if (widget.images.length > 1)
          Positioned(
            left: 0,
            right: 0,
            bottom: 24,
            child: SafeArea(child: PageDots(count: widget.images.length, index: _i, onDark: true)),
          ),
      ]),
    );
  }
}

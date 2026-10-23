import 'dart:async';
import 'dart:math' as math;

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
  const ProductScreen({super.key, required this.slug, this.initialVariantId});
  final String slug;

  /// Variant to preselect (session restore); ignored if missing or unavailable.
  final String? initialVariantId;
  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  Product? _fetched;
  bool _loading = false;
  bool _failed = false;

  /// True only when the server answered 404; network errors keep the generic
  /// "could not load" message so a flaky connection never claims deletion.
  bool _notFound = false;
  String? _fetchedLocale;
  late final ShellController _shell;

  @override
  void initState() {
    super.initState();
    _shell = context.read<ShellController>();
    _shell.productOpened(widget.slug, widget.initialVariantId);
  }

  @override
  void dispose() {
    _shell.productClosed(widget.slug);
    super.dispose();
  }

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
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
        _notFound = e is ApiException && e.statusCode == 404;
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
      body = _ProductBody(
        key: ValueKey('${product.id}-$locale'),
        product: product,
        initialVariantId: widget.initialVariantId,
        onVariantChanged: (id) => _shell.productOpened(widget.slug, id),
      );
    } else if (_failed) {
      body = ErrorView(message: _notFound ? l.productNotFound : l.loadError, onRetry: () => _fetch(locale));
    } else {
      body = const LoadingView();
    }
    return Scaffold(
      // The name is shown once, in the body; the bar stays compact.
      appBar: AppBar(
        toolbarHeight: 52,
        actions: [
          if (product != null) FavoriteButton(productId: product.id),
          const SizedBox(width: 4),
        ],
      ),
      body: body,
    );
  }
}

class _ProductBody extends StatefulWidget {
  const _ProductBody({super.key, required this.product, this.initialVariantId, required this.onVariantChanged});
  final Product product;
  final String? initialVariantId;
  final ValueChanged<String?> onVariantChanged;
  @override
  State<_ProductBody> createState() => _ProductBodyState();
}

class _ProductBodyState extends State<_ProductBody> {
  final _pager = PageController();
  int _page = 0;
  Variant? _variant;
  SellingUnit? _unit;
  int _qty = 1;
  bool _titleExpanded = false;
  bool _justAdded = false;
  Timer? _addedTimer;

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    Variant? restored;
    for (final v in p.variants) {
      if (v.id == widget.initialVariantId && v.available) restored = v;
    }
    _variant = restored ?? p.defaultVariant;
    _unit = _variant?.defaultUnit;
    widget.onVariantChanged(_variant?.id);
    if (restored != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToVariantImage(restored!, animate: false));
    }
  }

  @override
  void dispose() {
    _addedTimer?.cancel();
    _pager.dispose();
    super.dispose();
  }

  void _jumpToVariantImage(Variant v, {bool animate = true}) {
    final img = v.image;
    if (img == null || !mounted) return;
    final i = widget.product.gallery.indexWhere((g) => g.src == img.src);
    if (i < 0 || !_pager.hasClients) return;
    if (animate) {
      _pager.animateToPage(i, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    } else {
      _pager.jumpToPage(i);
    }
  }

  void _selectVariant(Variant v) {
    setState(() {
      _variant = v;
      _unit = v.defaultUnit;
      _qty = 1;
    });
    widget.onVariantChanged(v.id);
    _jumpToVariantImage(v);
  }

  void _addToCart() {
    if (_justAdded) return; // ignore double taps while the confirmation shows
    final l = AppLocalizations.of(context);
    final p = widget.product;
    final v = _variant!;
    final u = _unit!;
    context.read<CartStore>().add(
      CartLine(
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
      ),
    );
    setState(() => _justAdded = true);
    _addedTimer?.cancel();
    _addedTimer = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _justAdded = false);
    });
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(l.addedToCart),
          // A SnackBar with an action persists by default; it would then sit over the
          // cart's WhatsApp button after navigating. Auto-dismiss it instead.
          persist: false,
          duration: const Duration(seconds: 3),
          action: SnackBarAction(
            label: l.viewCart,
            textColor: BrandColors.leafOnDark,
            onPressed: () {
              ScaffoldMessenger.of(context).hideCurrentSnackBar();
              Navigator.of(context).popUntil((r) => r.isFirst);
              context.read<ShellController>().go(3);
            },
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final mq = MediaQuery.of(context);
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
    // Gallery is bounded so the title and price stay on the first screen.
    final galleryHeight = math.min(mq.size.width * 0.85, mq.size.height * 0.38);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              Container(
                height: galleryHeight,
                color: Colors.white,
                child: gallery.isEmpty
                    ? const NetImage(image: null)
                    : Stack(
                        children: [
                          PageView.builder(
                            controller: _pager,
                            itemCount: gallery.length,
                            onPageChanged: (i) => setState(() => _page = i),
                            itemBuilder: (context, i) => Semantics(
                              button: true,
                              label: l.imageOf(i + 1, gallery.length),
                              child: GestureDetector(
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    fullscreenDialog: true,
                                    builder: (_) => ImageViewer(images: gallery, initial: i),
                                  ),
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: NetImage(image: gallery[i], fit: BoxFit.contain),
                                ),
                              ),
                            ),
                          ),
                          if (gallery.length > 1)
                            Positioned(
                              left: 0,
                              right: 0,
                              bottom: 8,
                              child: PageDots(count: gallery.length, index: _page),
                            ),
                        ],
                      ),
              ),
              const Divider(),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (p.brand != null && p.brand!.isNotEmpty)
                      Text(
                        p.brand!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: t.labelMedium?.copyWith(color: BrandColors.leaf, fontWeight: FontWeight.w700),
                      ),
                    const SizedBox(height: 2),
                    Semantics(
                      header: true,
                      child: GestureDetector(
                        onTap: () => setState(() => _titleExpanded = !_titleExpanded),
                        child: Text(
                          p.name,
                          key: const ValueKey('product-title'),
                          maxLines: _titleExpanded ? null : 3,
                          overflow: _titleExpanded ? null : TextOverflow.ellipsis,
                          style: t.titleLarge,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        Text(
                          formatAgorot(price),
                          key: const ValueKey('product-price'),
                          textDirection: TextDirection.ltr,
                          style: t.titleLarge?.copyWith(color: BrandColors.forest, fontWeight: FontWeight.w800),
                        ),
                        if (!canBuy) _Pill(text: l.outOfStock, color: BrandColors.muted),
                        if (v?.offer != null) _Pill(text: l.offerLabel, color: BrandColors.leaf),
                      ],
                    ),
                    if (p.variants.length > 1) ...[
                      const SizedBox(height: 16),
                      Text(l.option, style: t.titleSmall),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final variant in p.variants)
                            ChoiceChip(
                              key: ValueKey('variant-${variant.id}'),
                              label: Text(variant.label),
                              selected: variant.id == v?.id,
                              showCheckmark: true,
                              side: BorderSide(
                                color: variant.id == v?.id ? BrandColors.forest : BrandColors.hairline,
                                width: variant.id == v?.id ? 1.5 : 1,
                              ),
                              onSelected: variant.available ? (_) => _selectVariant(variant) : null,
                            ),
                        ],
                      ),
                    ],
                    if (v != null && v.sellingUnits.length > 1) ...[
                      const SizedBox(height: 16),
                      Text(l.sellingUnit, style: t.titleSmall),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final unit in v.sellingUnits)
                            ChoiceChip(
                              label: Text('${unit.label} · ${formatAgorot(unit.priceAgorot)}'),
                              selected: unit.id == u?.id,
                              side: BorderSide(
                                color: unit.id == u?.id ? BrandColors.forest : BrandColors.hairline,
                                width: unit.id == u?.id ? 1.5 : 1,
                              ),
                              onSelected: (_) => setState(() {
                                _unit = unit;
                                _qty = _qty.clamp(1, unit.maxQuantity < 1 ? 1 : unit.maxQuantity);
                              }),
                            ),
                        ],
                      ),
                    ],
                    if (canBuy) ...[
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(child: Text(l.quantity, style: t.titleSmall)),
                          QuantityStepper(value: _qty, max: u.maxQuantity, onChanged: (q) => setState(() => _qty = q)),
                        ],
                      ),
                    ],
                    if (parts != null && parts.description.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      const Divider(),
                      const SizedBox(height: 12),
                      _TextSection(title: l.description, body: parts.description),
                    ],
                    if (usage.isNotEmpty) ...[const SizedBox(height: 12), _TextSection(title: l.howToUse, body: usage)],
                  ],
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: BrandColors.hairline)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const ValueKey('add-to-cart'),
                  onPressed: canBuy ? _addToCart : null,
                  icon: Icon(_justAdded ? Icons.check_circle : Icons.add_shopping_cart, size: 20),
                  label: Text(
                    canBuy ? '${l.addToCart} · ${formatAgorot(price * _qty)}' : l.outOfStock,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(Radii.sm)),
    child: Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color)),
  );
}

/// Plain section (no card chrome); long text collapses to 6 lines with a toggle.
class _TextSection extends StatefulWidget {
  const _TextSection({required this.title, required this.body});
  final String title;
  final String body;
  @override
  State<_TextSection> createState() => _TextSectionState();
}

class _TextSectionState extends State<_TextSection> {
  bool _expanded = false;
  static const _collapsedLines = 6;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final style = t.bodyMedium;
    return LayoutBuilder(
      builder: (context, c) {
        final tp = TextPainter(
          text: TextSpan(text: widget.body, style: style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          maxLines: _collapsedLines,
        )..layout(maxWidth: c.maxWidth);
        final long = tp.didExceedMaxLines;
        tp.dispose();
        final ml = MaterialLocalizations.of(context);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(header: true, child: Text(widget.title, style: t.titleSmall)),
            const SizedBox(height: 6),
            Text(
              widget.body,
              style: style,
              maxLines: _expanded ? null : _collapsedLines,
              overflow: _expanded ? null : TextOverflow.ellipsis,
            ),
            if (long)
              TextButton(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(48, 40)),
                onPressed: () => setState(() => _expanded = !_expanded),
                child: Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  semanticLabel: _expanded ? ml.expandedIconTapHint : ml.collapsedIconTapHint,
                ),
              ),
          ],
        );
      },
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
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
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
          ],
        ),
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
      body: Stack(
        children: [
          PageView.builder(
            controller: _c,
            itemCount: widget.images.length,
            onPageChanged: (i) => setState(() => _i = i),
            itemBuilder: (_, i) => InteractiveViewer(
              minScale: 1,
              maxScale: 5,
              child: Center(
                child: NetImage(image: widget.images[i], fit: BoxFit.contain),
              ),
            ),
          ),
          if (widget.images.length > 1)
            Positioned(
              left: 0,
              right: 0,
              bottom: 24,
              child: SafeArea(
                child: PageDots(count: widget.images.length, index: _i, onDark: true),
              ),
            ),
        ],
      ),
    );
  }
}

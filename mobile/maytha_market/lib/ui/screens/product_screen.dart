import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/description_split.dart';
import '../../core/money.dart';
import '../../core/title_split.dart';
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

    if (product != null) {
      // Edge-to-edge: the product image runs under the status bar, so the
      // page has no app bar; back/favorite float over the image.
      return AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
        child: Scaffold(
          body: _ProductBody(
            key: ValueKey('${product.id}-$locale'),
            product: product,
            initialVariantId: widget.initialVariantId,
            onVariantChanged: (id) => _shell.productOpened(widget.slug, id),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(toolbarHeight: 52),
      body: _failed
          ? ErrorView(message: _notFound ? l.productNotFound : l.loadError, onRetry: () => _fetch(locale))
          : const LoadingView(),
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
  final _barKey = GlobalKey();
  int _page = 0;
  Variant? _variant;
  SellingUnit? _unit;
  int _qty = 1;
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

  /// How many more of the selected variant + selling unit may be added,
  /// given the unit's max quantity and what is already in the cart.
  int _remainingFor(CartStore cart) {
    final v = _variant;
    final u = _unit;
    if (v == null || u == null) return 0;
    final key = '${widget.product.id}|${v.id}|${u.id}';
    var inCart = 0;
    for (final line in cart.lines) {
      if (line.key == key) inCart += line.quantity;
    }
    final r = u.maxQuantity - inCart;
    return r > 0 ? r : 0;
  }

  void _addToCart() {
    if (_justAdded) return; // ignore double taps while the confirmation shows
    final remaining = _remainingFor(context.read<CartStore>());
    if (remaining <= 0) return;
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
        quantity: _qty > remaining ? remaining : _qty,
        imageSrc: (v.image ?? p.image)?.src,
      ),
    );
    setState(() => _justAdded = true);
    _addedTimer?.cancel();
    _addedTimer = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _justAdded = false);
    });
    // The add button lives in the body (not a bottomNavigationBar), so lift
    // the floating snackbar above it instead of covering it.
    final barBox = _barKey.currentContext?.findRenderObject() as RenderBox?;
    final lift = (barBox?.hasSize ?? false) ? barBox!.size.height : 0.0;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(l.addedToCart),
          margin: EdgeInsets.fromLTRB(16, 0, 16, lift + 8),
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
    final v = _variant;
    final u = _unit;
    final canBuy = p.available && v != null && v.available && u != null && u.maxQuantity > 0;
    // Re-evaluated whenever the cart changes (e.g. lines removed elsewhere).
    final remaining = canBuy ? context.select<CartStore, int>(_remainingFor) : 0;
    final canAdd = canBuy && remaining > 0;
    final qty = _qty > remaining && remaining > 0 ? remaining : _qty;
    final price = u?.priceAgorot ?? p.priceAgorot;
    final parts = p.description == null ? null : splitDescription(p.description!);
    final usage = [
      if (parts?.usage != null) parts!.usage!,
      if (p.usageNotes != null && p.usageNotes!.trim().isNotEmpty) p.usageNotes!.trim(),
    ].join('\n\n');
    final title = splitProductTitle(p.name);
    // ~39% of the screen, including the status bar the image runs under.
    final heroHeight = math.max(260.0, mq.size.height * 0.39);
    final chipLabels = shortOptionLabels([for (final x in p.variants) x.label]);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              _Hero(
                height: heroHeight,
                product: p,
                pager: _pager,
                page: _page,
                onPageChanged: (i) => setState(() => _page = i),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (p.brand != null && p.brand!.isNotEmpty)
                      Text(
                        p.brand!.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: t.labelLarge?.copyWith(
                          color: BrandColors.forest,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                        ),
                      ),
                    const SizedBox(height: 4),
                    LayoutBuilder(
                      builder: (context, c) => Row(
                        children: [
                          Expanded(
                            child: Semantics(
                              header: true,
                              label: p.name,
                              excludeSemantics: true,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    title.title,
                                    key: const ValueKey('product-title'),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: t.headlineSmall?.copyWith(fontSize: 21, height: 1.35),
                                  ),
                                  if (title.subtitle != null) ...[
                                    const SizedBox(height: 4),
                                    Text(
                                      title.subtitle!,
                                      key: const ValueKey('product-subtitle'),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: t.bodyLarge?.copyWith(color: BrandColors.muted, fontSize: 16),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          // Never clipped: scales down if very large text would
                          // otherwise take more than ~45% of the row.
                          ConstrainedBox(
                            constraints: BoxConstraints(maxWidth: c.maxWidth * 0.45),
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                formatAgorot(price),
                                key: const ValueKey('product-price'),
                                textDirection: TextDirection.ltr,
                                maxLines: 1,
                                style: const TextStyle(
                                  fontSize: 34,
                                  height: 1.1,
                                  fontWeight: FontWeight.w800,
                                  color: BrandColors.forest,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (!canBuy || v.offer != null) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          if (!canBuy) _Pill(text: l.outOfStock, color: BrandColors.muted),
                          if (v?.offer != null) _Pill(text: l.offerLabel, color: BrandColors.leaf),
                        ],
                      ),
                    ],
                    if (p.variants.length > 1) ...[
                      const SizedBox(height: 22),
                      Semantics(header: true, child: Text(optionTitle(l, p), style: t.titleMedium)),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          for (var i = 0; i < p.variants.length; i++)
                            _OptionChip(
                              key: ValueKey('variant-${p.variants[i].id}'),
                              label: compactOptionLabel(chipLabels[i], arabicUi: l.localeName.startsWith('ar')),
                              semanticLabel: p.variants[i].available
                                  ? p.variants[i].label
                                  : '${p.variants[i].label}, ${l.unavailableOption}',
                              swatch: _Swatch(image: p.variants[i].image),
                              selected: p.variants[i].id == v?.id,
                              enabled: p.variants[i].available,
                              onTap: () => _selectVariant(p.variants[i]),
                            ),
                        ],
                      ),
                    ],
                    if (v != null && v.sellingUnits.length > 1) ...[
                      const SizedBox(height: 20),
                      Semantics(header: true, child: Text(l.sellingUnit, style: t.titleMedium)),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          for (final unit in v.sellingUnits)
                            _OptionChip(
                              key: ValueKey('unit-${unit.id}'),
                              label: '${unit.label} · ${formatAgorot(unit.priceAgorot)}',
                              semanticLabel: '${unit.label} · ${formatAgorot(unit.priceAgorot)}',
                              selected: unit.id == u?.id,
                              enabled: unit.maxQuantity > 0,
                              onTap: () => setState(() {
                                _unit = unit;
                                _qty = _qty.clamp(1, unit.maxQuantity < 1 ? 1 : unit.maxQuantity);
                              }),
                            ),
                        ],
                      ),
                    ],
                    if (canBuy) ...[
                      const SizedBox(height: 22),
                      Row(
                        children: [
                          Expanded(child: Text(l.quantity, style: t.titleMedium)),
                          const SizedBox(width: 12),
                          QuantityStepper(
                            tinted: true,
                            value: qty,
                            max: remaining < 1 ? 1 : remaining,
                            onChanged: (q) => setState(() => _qty = q),
                          ),
                        ],
                      ),
                    ],
                    if ((parts != null && parts.description.isNotEmpty) || usage.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      const Divider(),
                      const SizedBox(height: 6),
                      _DescriptionSection(body: parts?.description ?? '', usage: usage),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        Container(
          key: _barKey,
          decoration: const BoxDecoration(
            color: BrandColors.ivory,
            boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 12, offset: Offset(0, -2))],
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const ValueKey('add-to-cart'),
                  onPressed: canAdd ? _addToCart : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 56),
                    backgroundColor: BrandColors.forest,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.lg)),
                    textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        child: Text(
                          !canBuy
                              ? l.outOfStock
                              : canAdd
                              ? '${l.addToCart} · ${formatAgorot(price * qty)}'
                              : l.maxInCart,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Icon(_justAdded ? Icons.check_circle : Icons.shopping_cart_outlined, size: 24),
                    ],
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

/// "اختر الرائحة" / "Choose scent" from the product's real option name (the
/// variants' attribute key); "اختر النوع" / "Choose option" otherwise.
String optionTitle(AppLocalizations l, Product p) {
  String? key;
  for (final v in p.variants) {
    if (v.attributes.isNotEmpty) {
      key = v.attributes.keys.first.trim();
      break;
    }
  }
  if (key == null || key.isEmpty) return l.chooseOptionFallback;
  final isArabicKey = RegExp(r'[؀-ۿ]').hasMatch(key);
  if (l.localeName.startsWith('ar')) {
    return isArabicKey ? l.chooseOption(key) : l.chooseOptionFallback;
  }
  if (!isArabicKey) return l.chooseOption(key.toLowerCase());
  // English UI with an Arabic attribute key: translate the common ones.
  final en = switch (key.replaceFirst(RegExp('^ال'), '')) {
    'رائحة' || 'روائح' => l.optionScent,
    'حجم' || 'سعة' => l.optionSize,
    'لون' => l.optionColor,
    'نوع' => l.optionType,
    _ => null,
  };
  return en == null ? l.chooseOptionFallback : l.chooseOption(en);
}

/// Full-bleed image area: runs under the status bar, rounded bottom corners,
/// swipeable real product photos (never cropped), floating back/favorite.
class _Hero extends StatelessWidget {
  const _Hero({
    required this.height,
    required this.product,
    required this.pager,
    required this.page,
    required this.onPageChanged,
  });
  final double height;
  final Product product;
  final PageController pager;
  final int page;
  final ValueChanged<int> onPageChanged;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final top = MediaQuery.paddingOf(context).top;
    final gallery = product.gallery;
    return SizedBox(
      height: height,
      child: Stack(
        children: [
          Positioned.fill(
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(28)),
              child: ColoredBox(
                color: Colors.white,
                child: gallery.isEmpty
                    ? const NetImage(image: null)
                    : PageView.builder(
                        controller: pager,
                        itemCount: gallery.length,
                        onPageChanged: onPageChanged,
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
                              // Clear of the status bar at the top; room for
                              // the page dots at the bottom.
                              padding: EdgeInsets.fromLTRB(24, top + 20, 24, gallery.length > 1 ? 28 : 16),
                              child: NetImage(image: gallery[i], fit: BoxFit.contain),
                            ),
                          ),
                        ),
                      ),
              ),
            ),
          ),
          if (gallery.length > 1)
            Positioned(
              left: 0,
              right: 0,
              bottom: 12,
              child: PageDots(count: gallery.length, index: page),
            ),
          // Mockup positions: back at the top-left, favorite at the top-right,
          // in both reading directions (the chevron points left, toward the
          // edge it sits on).
          Positioned(
            left: 16,
            top: top + 10,
            child: _RoundButton(
              child: IconButton(
                key: const ValueKey('product-back'),
                constraints: const BoxConstraints.tightFor(width: 48, height: 48),
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                // Fixed physical direction: the chevron always points left (no RTL mirroring).
                icon: const Directionality(
                  textDirection: TextDirection.ltr,
                  child: Icon(Icons.chevron_left_rounded, size: 30, color: BrandColors.text),
                ),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
          Positioned(
            right: 16,
            top: top + 10,
            child: _RoundButton(child: FavoriteButton(productId: product.id)),
          ),
        ],
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    width: 48,
    height: 48,
    decoration: const BoxDecoration(
      color: Colors.white,
      shape: BoxShape.circle,
      boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 10, offset: Offset(0, 2))],
    ),
    child: Center(child: child),
  );
}

/// Leading swatch of a variant chip. The data has no colour field, so it is a
/// small circular crop of the variant's own photo (neutral dot otherwise).
class _Swatch extends StatelessWidget {
  const _Swatch({required this.image});
  final ProductImage? image;
  static const _dot = DecoratedBox(
    decoration: BoxDecoration(color: BrandColors.hairline, shape: BoxShape.circle),
  );
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 24,
    height: 24,
    child: image == null
        ? _dot
        : ClipOval(
            child: ExcludeSemantics(
              child: NetImage(image: image, fit: BoxFit.cover, fallback: _dot),
            ),
          ),
  );
}

/// Rounded pill option (variant or selling unit), as in the approved mockup.
class _OptionChip extends StatelessWidget {
  const _OptionChip({
    super.key,
    required this.label,
    required this.semanticLabel,
    required this.selected,
    required this.enabled,
    required this.onTap,
    this.swatch,
  });
  final String label;
  final String semanticLabel;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;
  final Widget? swatch;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final tap = enabled && !selected ? onTap : null;
    final chip = Material(
      color: selected ? BrandColors.sage : Colors.white,
      shape: StadiumBorder(
        side: BorderSide(color: selected ? BrandColors.forest : BrandColors.hairline, width: selected ? 1.5 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: tap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: EdgeInsetsDirectional.fromSTEB(swatch == null ? 16 : 10, 8, 16, 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (swatch != null) ...[swatch!, const SizedBox(width: 8)],
                Flexible(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.bodyMedium?.copyWith(
                      color: selected ? BrandColors.forest : BrandColors.text,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      decoration: enabled ? null : TextDecoration.lineThrough,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label: semanticLabel,
      excludeSemantics: true,
      onTap: tap,
      child: Opacity(opacity: enabled ? 1 : 0.45, child: chip),
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

/// "الوصف" with a chevron: collapsed shows three grey lines; expanded shows
/// the full description plus the usage notes.
class _DescriptionSection extends StatefulWidget {
  const _DescriptionSection({required this.body, required this.usage});
  final String body;
  final String usage;
  @override
  State<_DescriptionSection> createState() => _DescriptionSectionState();
}

class _DescriptionSectionState extends State<_DescriptionSection> {
  bool _expanded = false;
  static const _collapsedLines = 3;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final ml = MaterialLocalizations.of(context);
    final style = t.bodyLarge?.copyWith(color: BrandColors.muted, height: 1.6);
    return LayoutBuilder(
      builder: (context, c) {
        final tp = TextPainter(
          text: TextSpan(text: widget.body, style: style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          maxLines: _collapsedLines,
        )..layout(maxWidth: c.maxWidth);
        final expandable = tp.didExceedMaxLines || widget.usage.isNotEmpty;
        tp.dispose();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              button: expandable,
              expanded: expandable ? _expanded : null,
              child: InkWell(
                key: const ValueKey('description-toggle'),
                borderRadius: BorderRadius.circular(Radii.sm),
                onTap: expandable ? () => setState(() => _expanded = !_expanded) : null,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: Row(
                    children: [
                      Expanded(child: Text(l.description, style: t.titleMedium)),
                      if (expandable)
                        Icon(
                          _expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                          color: BrandColors.muted,
                          semanticLabel: _expanded ? ml.expandedIconTapHint : ml.collapsedIconTapHint,
                        ),
                    ],
                  ),
                ),
              ),
            ),
            if (widget.body.isNotEmpty)
              Text(
                widget.body,
                key: const ValueKey('description-body'),
                style: style,
                maxLines: _expanded ? null : _collapsedLines,
                overflow: _expanded ? null : TextOverflow.ellipsis,
              ),
            if (_expanded && widget.usage.isNotEmpty) ...[
              const SizedBox(height: 14),
              Semantics(header: true, child: Text(l.howToUse, style: t.titleSmall)),
              const SizedBox(height: 6),
              Text(widget.usage, style: style),
            ],
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

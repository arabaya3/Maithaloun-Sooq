import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../core/money.dart';
import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../theme.dart';

/// The logo symbol (roof + cart + leaves), cropped from the official logo file.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.height = 28});
  final double height;
  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/brand/logo-mark.png',
    height: height,
    fit: BoxFit.contain,
    filterQuality: FilterQuality.medium,
    excludeFromSemantics: true,
  );
}

/// Full official logo (symbol + wordmark) as supplied.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 72});
  final double size;
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(size * 0.18),
    child: Image.asset(
      'assets/brand/logo-original.png',
      width: size,
      height: size,
      semanticLabel: 'MAYTHA MARKET',
      filterQuality: FilterQuality.medium,
    ),
  );
}

/// Compact app-bar brand: symbol + two-line wordmark. Does not dominate the bar.
class BrandHeader extends StatelessWidget {
  const BrandHeader({super.key});
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Semantics(
      header: true,
      label: 'MAYTHA MARKET',
      child: ExcludeSemantics(
        child: MediaQuery.withNoTextScaling(
          // The wordmark is a logo, not body text: fixed size keeps the bar compact.
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BrandMark(height: 30),
              const SizedBox(width: 8),
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'MAYTHA',
                    textDirection: TextDirection.ltr,
                    style: t.titleMedium?.copyWith(
                      fontSize: 16,
                      height: 1.0,
                      letterSpacing: 1.6,
                      fontWeight: FontWeight.w800,
                      color: BrandColors.forest,
                    ),
                  ),
                  Text(
                    'MARKET',
                    textDirection: TextDirection.ltr,
                    style: t.labelSmall?.copyWith(
                      fontSize: 9.5,
                      height: 1.2,
                      letterSpacing: 3.2,
                      fontWeight: FontWeight.w700,
                      color: BrandColors.leaf,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Network image with relative-URL resolution and a quiet placeholder.
class NetImage extends StatelessWidget {
  const NetImage({super.key, required this.image, this.fit = BoxFit.cover, this.fallback});
  final ProductImage? image;
  final BoxFit fit;

  /// Shown when there is no image or it fails to load (default: brand mark).
  final Widget? fallback;

  @override
  Widget build(BuildContext context) {
    final img = image;
    if (img == null) return fallback ?? const _ImagePlaceholder();
    return Semantics(
      image: true,
      label: img.alt.isEmpty ? null : img.alt,
      child: CachedNetworkImage(
        imageUrl: AppConfig.resolveUrl(img.src),
        fit: fit,
        fadeInDuration: const Duration(milliseconds: 150),
        placeholder: (_, _) => const ColoredBox(color: BrandColors.sage),
        errorWidget: (_, _, _) => fallback ?? const _ImagePlaceholder(),
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();
  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: BrandColors.sage,
    child: Center(child: Opacity(opacity: 0.5, child: BrandMark(height: 28))),
  );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: CircularProgressIndicator());
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off_rounded, size: 44, color: BrandColors.muted),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(l.retry)),
          ],
        ),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.message, this.action});
  final IconData icon;
  final String message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 44, color: BrandColors.leaf),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    ),
  );
}

class FavoriteButton extends StatelessWidget {
  const FavoriteButton({super.key, required this.productId, this.compact = false});
  final String productId;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final fav = context.watch<FavoritesStore>().contains(productId);
    final icon = Icon(
      fav ? Icons.favorite : Icons.favorite_border,
      size: compact ? 20 : 24,
      color: fav ? BrandColors.forest : BrandColors.muted,
    );
    return IconButton(
      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
      tooltip: fav ? l.removeFavorite : l.addFavorite,
      icon: compact
          ? DecoratedBox(
              decoration: const BoxDecoration(color: Color(0xE6FFFFFF), shape: BoxShape.circle),
              child: Padding(padding: const EdgeInsets.all(6), child: icon),
            )
          : icon,
      onPressed: () => context.read<FavoritesStore>().toggle(productId),
    );
  }
}

/// Text metrics shared by [ProductCard] and [ProductSliverGrid] so the grid can
/// give each cell exactly the height its text needs at the current text scale.
class ProductCardMetrics {
  static const padH = 10.0;
  static const padTop = 8.0;
  static const padBottom = 10.0;
  static const brandSize = 11.5, brandHeight = 1.3;
  static const titleSize = 13.5, titleHeight = 1.35;
  static const priceSize = 15.0, priceHeight = 1.3;
  static const gapTitle = 2.0, gapPrice = 4.0;

  /// Height of the text block below the image.
  static double textBlockHeight(TextScaler s) =>
      padTop +
      s.scale(brandSize) * brandHeight +
      gapTitle +
      2 * s.scale(titleSize) * titleHeight +
      gapPrice +
      s.scale(priceSize) * priceHeight +
      padBottom;
}

class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onTap});
  final Product product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final price = formatAgorot(product.priceAgorot);
    StrutStyle strut(double size, double h) => StrutStyle(fontSize: size, height: h, forceStrutHeight: true);
    final brand = product.brand?.trim() ?? '';
    return Semantics(
      button: true,
      label: '${product.name}, $price${product.available ? '' : ', ${l.outOfStock}'}',
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // The image takes whatever height the text block leaves, so the
              // text (and price) can never be pushed out of the cell.
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ColoredBox(
                      color: Colors.white,
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: ExcludeSemantics(
                          child: NetImage(image: product.image, fit: BoxFit.contain),
                        ),
                      ),
                    ),
                    PositionedDirectional(top: 2, end: 2, child: FavoriteButton(productId: product.id, compact: true)),
                    if (!product.available)
                      PositionedDirectional(
                        bottom: 6,
                        start: 6,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: BrandColors.deepGreen,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(l.outOfStock, style: t.labelSmall?.copyWith(color: Colors.white)),
                        ),
                      ),
                  ],
                ),
              ),
              const Divider(),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  ProductCardMetrics.padH,
                  ProductCardMetrics.padTop,
                  ProductCardMetrics.padH,
                  ProductCardMetrics.padBottom,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      brand.isEmpty ? ' ' : brand,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      strutStyle: strut(ProductCardMetrics.brandSize, ProductCardMetrics.brandHeight),
                      style: t.labelSmall?.copyWith(
                        fontSize: ProductCardMetrics.brandSize,
                        height: ProductCardMetrics.brandHeight,
                        color: BrandColors.muted,
                      ),
                    ),
                    const SizedBox(height: ProductCardMetrics.gapTitle),
                    SizedBox(
                      height:
                          2 *
                          MediaQuery.textScalerOf(context).scale(ProductCardMetrics.titleSize) *
                          ProductCardMetrics.titleHeight,
                      child: Text(
                        product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        strutStyle: strut(ProductCardMetrics.titleSize, ProductCardMetrics.titleHeight),
                        style: t.bodyMedium?.copyWith(
                          fontSize: ProductCardMetrics.titleSize,
                          height: ProductCardMetrics.titleHeight,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: ProductCardMetrics.gapPrice),
                    Text(
                      price,
                      key: const ValueKey('product-card-price'),
                      maxLines: 1,
                      textDirection: TextDirection.ltr,
                      strutStyle: strut(ProductCardMetrics.priceSize, ProductCardMetrics.priceHeight),
                      style: t.titleSmall?.copyWith(
                        fontSize: ProductCardMetrics.priceSize,
                        height: ProductCardMetrics.priceHeight,
                        color: BrandColors.forest,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Responsive product grid. Cell height = image area + the measured text block
/// at the current text scale (replaces the old fixed childAspectRatio: 0.62,
/// which clipped prices whenever the system font was enlarged).
class ProductSliverGrid extends StatelessWidget {
  const ProductSliverGrid({super.key, required this.products, required this.onOpen});
  final List<Product> products;
  final void Function(Product) onOpen;

  static const _spacing = 12.0;
  static const _maxCellWidth = 220.0;

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      sliver: SliverLayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.crossAxisExtent;
          final columns = ((width + _spacing) / (_maxCellWidth + _spacing)).ceil().clamp(2, 6);
          final cellWidth = (width - _spacing * (columns - 1)) / columns;
          // Image area ~0.8 of the cell width; +1 for the divider.
          final extent = cellWidth * 0.8 + 1 + ProductCardMetrics.textBlockHeight(scaler);
          return SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisSpacing: _spacing,
              crossAxisSpacing: _spacing,
              mainAxisExtent: extent.ceilToDouble() + 2,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, i) => ProductCard(product: products[i], onTap: () => onOpen(products[i])),
              childCount: products.length,
            ),
          );
        },
      ),
    );
  }
}

/// Compact quantity stepper with 48dp targets. In RTL the row mirrors, so
/// "decrease" sits at the reading start and "increase" at the reading end.
///
/// [tinted] is the product-page style: pill outline, circular light-green
/// buttons, and "−" always on the left / "+" on the right (as in the
/// approved product mockup, in both directions).
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.value,
    required this.max,
    required this.onChanged,
    this.min = 1,
    this.tinted = false,
  });
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;
  final bool tinted;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    const box = BoxConstraints(minWidth: 48, minHeight: 48);
    Widget button(IconData icon, String tip, VoidCallback? onPressed) => IconButton(
      constraints: box,
      iconSize: tinted ? 22 : 20,
      tooltip: tip,
      onPressed: onPressed,
      style: tinted
          ? IconButton.styleFrom(
              backgroundColor: BrandColors.sage,
              foregroundColor: BrandColors.forest,
              disabledBackgroundColor: BrandColors.sage.withValues(alpha: 0.5),
              disabledForegroundColor: BrandColors.muted.withValues(alpha: 0.5),
            )
          : null,
      icon: Icon(icon),
    );
    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(Icons.remove, l.decrease, value > min ? () => onChanged(value - 1) : null),
        Semantics(
          label: l.quantity,
          value: '$value',
          child: ConstrainedBox(
            constraints: BoxConstraints(minWidth: tinted ? 44 : 28),
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: tinted ? 17 : 15),
            ),
          ),
        ),
        button(Icons.add, l.increase, value < max ? () => onChanged(value + 1) : null),
      ],
    );
    return Container(
      padding: tinted ? const EdgeInsets.all(4) : null,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: BrandColors.hairline),
        borderRadius: BorderRadius.circular(tinted ? 30 : Radii.md),
      ),
      child: tinted ? Directionality(textDirection: TextDirection.ltr, child: row) : row,
    );
  }
}

/// Cover image for a category tile. The API has no category images, so the
/// first in-stock product with an image represents the category (falling back
/// to any product with an image). Null when the category has no images.
ProductImage? categoryCoverImage(Catalog catalog, String categoryCode) {
  ProductImage? any;
  for (final p in catalog.products) {
    if (p.categoryCode != categoryCode || p.image == null) continue;
    if (p.available) return p.image;
    any ??= p.image;
  }
  return any;
}

/// Maps the catalog's category icon names (lucide names shared with the
/// website) to Material icons for the designed fallback tile.
IconData categoryIconData(String? icon) => switch (icon) {
  'sparkles' => Icons.auto_awesome_outlined,
  'cooking-pot' => Icons.soup_kitchen_outlined,
  'shirt' => Icons.local_laundry_service_outlined,
  'bath' => Icons.bathtub_outlined,
  'sofa' => Icons.weekend_outlined,
  'wind' => Icons.air,
  'brush-cleaning' || 'broom' => Icons.cleaning_services_outlined,
  'scroll-text' => Icons.receipt_long_outlined,
  'heart' => Icons.favorite_border,
  'baby' => Icons.child_care_outlined,
  'spray' => Icons.sanitizer_outlined,
  _ => Icons.category_outlined,
};

/// Designed fallback for a category without a usable image: brand-tinted
/// tile with the category's icon (never an empty placeholder).
class CategoryIconFallback extends StatelessWidget {
  const CategoryIconFallback({super.key, this.icon});
  final String? icon;
  @override
  Widget build(BuildContext context) => DecoratedBox(
    key: const ValueKey('category-icon-fallback'),
    decoration: BoxDecoration(color: BrandColors.sage, borderRadius: BorderRadius.circular(Radii.sm)),
    child: Center(child: Icon(categoryIconData(icon), color: BrandColors.forest, size: 28)),
  );
}

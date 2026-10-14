import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../core/money.dart';
import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../theme.dart';

String monogramSvg({bool onDark = false}) => '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M13.5 51V18.2c0-2 2.5-2.9 3.7-1.3L32 36.6l14.8-19.7c1.2-1.6 3.7-.7 3.7 1.3V51" fill="none" stroke="${onDark ? '#F7F5EF' : '#183D32'}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M32 31.2c-6.4-3.7-7.6-11.4-.1-19.7 7.6 8.3 6.4 16 .1 19.7Z" fill="${onDark ? '#A9C9B2' : '#6F9F80'}"/>
<path d="M32 29.2V15.4" stroke="#F7F5EF" stroke-width="1.1" fill="none"/>
</svg>
''';

class Monogram extends StatelessWidget {
  const Monogram({super.key, this.size = 40, this.onDark = false});
  final double size;
  final bool onDark;
  @override
  Widget build(BuildContext context) => SvgPicture.string(
        monogramSvg(onDark: onDark),
        width: size,
        height: size,
        semanticsLabel: 'MAYTHA MARKET',
      );
}

/// Network image with relative-URL resolution and a quiet placeholder.
class NetImage extends StatelessWidget {
  const NetImage({super.key, required this.image, this.fit = BoxFit.cover});
  final ProductImage? image;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final img = image;
    if (img == null) return const _ImagePlaceholder();
    return Semantics(
      image: true,
      label: img.alt.isEmpty ? null : img.alt,
      child: CachedNetworkImage(
        imageUrl: AppConfig.resolveUrl(img.src),
        fit: fit,
        placeholder: (_, _) => const ColoredBox(color: BrandColors.sage),
        errorWidget: (_, _, _) => const _ImagePlaceholder(),
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();
  @override
  Widget build(BuildContext context) => const ColoredBox(
        color: BrandColors.sage,
        child: Center(child: Monogram(size: 36)),
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
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off_rounded, size: 48, color: BrandColors.muted),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(l.retry)),
        ]),
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
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 48, color: BrandColors.leaf),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 16), action!],
          ]),
        ),
      );
}

class FavoriteButton extends StatelessWidget {
  const FavoriteButton({super.key, required this.productId});
  final String productId;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final fav = context.watch<FavoritesStore>().contains(productId);
    return IconButton(
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      tooltip: fav ? l.removeFavorite : l.addFavorite,
      icon: Icon(fav ? Icons.favorite : Icons.favorite_border,
          color: fav ? BrandColors.forest : BrandColors.muted),
      onPressed: () => context.read<FavoritesStore>().toggle(productId),
    );
  }
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
    return Semantics(
      button: true,
      label: '${product.name}, $price${product.available ? '' : ', ${l.outOfStock}'}',
      excludeSemantics: false,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            AspectRatio(
              aspectRatio: 1,
              child: Stack(fit: StackFit.expand, children: [
                ExcludeSemantics(child: NetImage(image: product.image)),
                PositionedDirectional(top: 0, end: 0, child: FavoriteButton(productId: product.id)),
                if (!product.available)
                  PositionedDirectional(
                    bottom: 8,
                    start: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                          color: BrandColors.deepGreen, borderRadius: BorderRadius.circular(8)),
                      child: Text(l.outOfStock,
                          style: t.labelSmall?.copyWith(color: Colors.white)),
                    ),
                  ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (product.brand != null && product.brand!.isNotEmpty)
                  Text(product.brand!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: t.labelSmall?.copyWith(color: BrandColors.muted)),
                Text(product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.bodyMedium?.copyWith(fontWeight: FontWeight.w600, height: 1.25)),
                const SizedBox(height: 4),
                Text(price,
                    textDirection: TextDirection.ltr,
                    style: t.titleSmall?.copyWith(color: BrandColors.forest, fontWeight: FontWeight.w700)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Responsive product grid as a sliver.
class ProductSliverGrid extends StatelessWidget {
  const ProductSliverGrid({super.key, required this.products, required this.onOpen});
  final List<Product> products;
  final void Function(Product) onOpen;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 0.62,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, i) => ProductCard(product: products[i], onTap: () => onOpen(products[i])),
          childCount: products.length,
        ),
      ),
    );
  }
}

/// Quantity stepper with 48dp targets.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({super.key, required this.value, required this.max, required this.onChanged, this.min = 1});
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: BrandColors.hairline),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
          tooltip: l.decrease,
          onPressed: value > min ? () => onChanged(value - 1) : null,
          icon: const Icon(Icons.remove),
        ),
        Semantics(
          label: l.quantity,
          value: '$value',
          child: SizedBox(
            width: 32,
            child: Text('$value',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
        ),
        IconButton(
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
          tooltip: l.increase,
          onPressed: value < max ? () => onChanged(value + 1) : null,
          icon: const Icon(Icons.add),
        ),
      ]),
    );
  }
}

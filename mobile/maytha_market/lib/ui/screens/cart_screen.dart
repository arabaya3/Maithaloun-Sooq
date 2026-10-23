import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config.dart';
import '../../core/money.dart';
import '../../core/whatsapp_message.dart';
import '../../data/models.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/cart.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

String quoteErrorMessage(AppLocalizations l, String? code) => switch (code) {
  'unknown_product' => l.errUnknownProduct,
  'unavailable_product' => l.errUnavailableProduct,
  'selling_unit_changed' => l.errSellingUnitChanged,
  'insufficient_stock' => l.errInsufficientStock,
  'rate_limited' => l.errRateLimited,
  'invalid_cart' => l.errInvalidCart,
  _ => l.quoteError,
};

/// Agorot still needed for free delivery; 0 once the subtotal reaches the
/// threshold (at exactly 50 ₪ delivery is already free).
int freeDeliveryRemainingAgorot(int subtotalAgorot, DeliveryInfo d) {
  final r = d.freeFromAgorot - subtotalAgorot;
  return r > 0 ? r : 0;
}

/// Progress toward free delivery in [0, 1].
double freeDeliveryProgress(int subtotalAgorot, DeliveryInfo d) =>
    d.freeFromAgorot <= 0 ? 1 : (subtotalAgorot / d.freeFromAgorot).clamp(0.0, 1.0).toDouble();

/// Text for the delivery row of the totals; the fee always comes from the
/// server quote, never recomputed on the device.
String deliveryFeeLabel(AppLocalizations l, Quote q) =>
    q.deliveryFeeAgorot == 0 ? l.free : formatAgorot(q.deliveryFeeAgorot);

/// Opens WhatsApp with the order message. Returns false if it could not be opened.
typedef UrlOpener = Future<bool> Function(Uri uri);

Future<bool> _defaultOpener(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

class CartScreen extends StatefulWidget {
  const CartScreen({super.key, this.openUrl = _defaultOpener});
  final UrlOpener openUrl;
  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  bool _sending = false;

  void _maybeQuote(CartStore cart, String locale, bool visible) {
    if (!visible || cart.isEmpty || cart.quoteStatus != QuoteStatus.idle) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && cart.quoteStatus == QuoteStatus.idle) cart.refreshQuote(locale);
    });
  }

  Future<void> _checkout() async {
    final l = AppLocalizations.of(context);
    final cart = context.read<CartStore>();
    final locale = context.read<LocaleStore>();
    final store = context.read<CatalogStore>().catalog?.store;
    final messenger = ScaffoldMessenger.of(context);
    // Guard against double taps landing before the disabled button rebuilds:
    // one tap opens WhatsApp once. The guard stays up until the launch returns.
    if (_sending) return;
    setState(() => _sending = true);
    try {
      final quote = await cart.refreshQuote(locale.code);
      if (!mounted) return;
      if (quote == null) {
        // A null quote with no error means the cart changed meanwhile: nothing is sent.
        if (cart.quoteStatus == QuoteStatus.error) {
          messenger.showSnackBar(SnackBar(content: Text(quoteErrorMessage(l, cart.quoteErrorCode))));
        }
        return;
      }
      final message = buildWhatsAppOrderMessage(
        quote: quote,
        arabic: locale.isArabic,
        storeUrl: AppConfig.normalizedBaseUrl,
      );
      final uri = whatsAppUri(store?.whatsAppE164, message);
      if (uri == null) {
        messenger.showSnackBar(SnackBar(content: Text(l.whatsAppNotConfigured)));
        return;
      }
      bool ok;
      try {
        ok = await widget.openUrl(uri);
      } catch (_) {
        ok = false;
      }
      if (!ok) messenger.showSnackBar(SnackBar(content: Text(l.whatsAppUnavailable)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final cart = context.watch<CartStore>();
    final locale = context.watch<LocaleStore>().code;
    final visible = context.select<ShellController, int>((s) => s.index) == 3;
    final delivery = context.select<CatalogStore, DeliveryInfo>(
      (c) => c.catalog?.store.delivery ?? const DeliveryInfo(),
    );
    _maybeQuote(cart, locale, visible);

    return Scaffold(
      appBar: AppBar(title: Text(l.navCart)),
      body: cart.isEmpty
          ? EmptyView(
              icon: Icons.shopping_bag_outlined,
              message: l.cartEmpty,
              action: OutlinedButton(
                onPressed: () => context.read<ShellController>().openCatalog(),
                child: Text(l.browseProducts),
              ),
            )
          : Builder(
              builder: (context) {
                // With large system text the full summary would cover most of a
                // small screen, so it scrolls with the lines and only the total
                // and the order button stay pinned.
                final scrollSummary = MediaQuery.textScalerOf(context).scale(10) > 13;
                Widget totals({required bool summary, required bool button, required bool pinned}) => _Totals(
                  cart: cart,
                  delivery: delivery,
                  sending: _sending,
                  onCheckout: _checkout,
                  locale: locale,
                  showSummary: summary,
                  showButton: button,
                  pinned: pinned,
                );
                final n = cart.lines.length;
                return Column(
                  children: [
                    Expanded(
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: n + (scrollSummary ? 1 : 0),
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, i) => i < n
                            ? _CartLineTile(line: cart.lines[i])
                            : totals(summary: true, button: false, pinned: false),
                      ),
                    ),
                    scrollSummary
                        ? totals(summary: false, button: true, pinned: true)
                        : totals(summary: true, button: true, pinned: true),
                  ],
                );
              },
            ),
    );
  }
}

class _CartLineTile extends StatelessWidget {
  const _CartLineTile({required this.line});
  final CartLine line;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final cart = context.read<CartStore>();
    final detail = [line.variantLabel, line.unitLabel].where((s) => s.isNotEmpty).join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () => openProduct(context, line.slug),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                  width: 72,
                  height: 72,
                  child: ExcludeSemantics(
                    child: NetImage(
                      image: line.imageSrc == null ? null : ProductImage(src: line.imageSrc!, alt: line.name),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    line.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  if (detail.isNotEmpty) Text(detail, style: t.bodySmall?.copyWith(color: BrandColors.muted)),
                  Text(
                    formatAgorot(line.unitPriceAgorot),
                    textDirection: TextDirection.ltr,
                    style: t.bodySmall?.copyWith(color: BrandColors.forest),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      QuantityStepper(
                        value: line.quantity,
                        max: line.maxQuantity,
                        onChanged: (q) => cart.setQuantity(line.key, q),
                      ),
                      const Spacer(),
                      IconButton(
                        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                        tooltip: '${l.remove} ${line.name}',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => cart.remove(line.key),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({
    required this.cart,
    required this.delivery,
    required this.sending,
    required this.onCheckout,
    required this.locale,
    this.showSummary = true,
    this.showButton = true,
    this.pinned = true,
  });
  final CartStore cart;
  final DeliveryInfo delivery;
  final bool sending;
  final VoidCallback onCheckout;
  final String locale;

  /// Free-delivery progress, subtotal and delivery rows, notes.
  final bool showSummary;
  final bool showButton;
  final bool pinned;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    final q = cart.quote;
    final subtotal = q?.itemsSubtotalAgorot ?? cart.model.estimatedSubtotalAgorot;
    final remaining = freeDeliveryRemainingAgorot(subtotal, delivery);

    Widget row(String label, String value, {bool bold = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: bold ? t.titleMedium?.copyWith(fontWeight: FontWeight.w800) : t.bodyMedium),
          ),
          Text(
            value,
            textDirection: TextDirection.ltr,
            style: bold
                ? t.titleMedium?.copyWith(fontWeight: FontWeight.w800, color: BrandColors.forest)
                : t.bodyMedium,
          ),
        ],
      ),
    );

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showSummary) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(color: BrandColors.sage, borderRadius: BorderRadius.circular(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  remaining > 0 ? l.freeDeliveryHint(formatAgorot(remaining)) : l.freeDeliveryReached,
                  key: const ValueKey('free-delivery-hint'),
                  style: t.bodySmall?.copyWith(color: BrandColors.deepGreen, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                ExcludeSemantics(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      key: const ValueKey('free-delivery-progress'),
                      value: freeDeliveryProgress(subtotal, delivery),
                      minHeight: 6,
                      color: BrandColors.forest,
                      backgroundColor: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (cart.quoteStatus == QuoteStatus.loading)
            const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator())
          else if (cart.quoteStatus == QuoteStatus.error)
            Row(
              children: [
                Expanded(
                  child: Text(
                    quoteErrorMessage(l, cart.quoteErrorCode),
                    style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error),
                  ),
                ),
                TextButton(onPressed: () => cart.refreshQuote(locale), child: Text(l.retry)),
              ],
            )
          else if (q != null) ...[
            row(l.subtotal, formatAgorot(q.itemsSubtotalAgorot)),
            row(l.delivery, deliveryFeeLabel(l, q)),
            if (showButton) ...[const Divider(height: 12), row(l.total, formatAgorot(q.totalAgorot), bold: true)],
          ],
          const SizedBox(height: 4),
          Text(l.deliveryNote, style: t.bodySmall?.copyWith(color: BrandColors.muted)),
        ],
        if (showButton) ...[
          // When the summary scrolls with the list (large text), the total
          // stays next to the order button.
          if (!showSummary && q != null && cart.quoteStatus == QuoteStatus.ready)
            row(l.total, formatAgorot(q.totalAgorot), bold: true),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: sending ? null : onCheckout,
              icon: sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.chat_outlined),
              label: Text(l.orderViaWhatsApp, maxLines: 2, textAlign: TextAlign.center),
            ),
          ),
        ],
      ],
    );

    if (!pinned) {
      return Card(
        child: Padding(padding: const EdgeInsets.all(12), child: content),
      );
    }
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: BrandColors.hairline)),
        ),
        child: content,
      ),
    );
  }
}

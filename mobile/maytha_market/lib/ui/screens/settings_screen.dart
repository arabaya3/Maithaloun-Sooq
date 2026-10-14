import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/whatsapp_message.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';

const appVersion = '1.0.0';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final locale = context.watch<LocaleStore>();
    final store = context.watch<CatalogStore>().catalog?.store;
    final waUri = whatsAppUri(store?.whatsAppE164);
    final t = Theme.of(context).textTheme;

    Widget section(String title, String body) => Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Semantics(header: true, child: Text(title, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
              const SizedBox(height: 6),
              Text(body, style: t.bodyMedium?.copyWith(height: 1.5)),
            ]),
          ),
        );

    return Scaffold(
      appBar: AppBar(title: Text(l.navSettings)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.settingsLanguage, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'ar', label: Text(l.arabic)),
                  ButtonSegment(value: 'en', label: Text(l.english)),
                ],
                selected: {locale.code},
                onSelectionChanged: (s) => locale.set(s.first),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        if (waUri != null)
          FilledButton.icon(
            onPressed: () async {
              final ok = await launchUrl(waUri, mode: LaunchMode.externalApplication);
              if (!ok && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.whatsAppUnavailable)));
              }
            },
            icon: const Icon(Icons.chat_outlined),
            label: Text(l.contactWhatsApp),
          ),
        const SizedBox(height: 12),
        section(l.deliveryTitle, l.deliveryBody),
        const SizedBox(height: 12),
        section(l.returnsTitle, l.returnsBody),
        const SizedBox(height: 12),
        section(l.privacyTitle, l.privacyBody),
        const SizedBox(height: 12),
        section(l.termsTitle, l.termsBody),
        const SizedBox(height: 24),
        const Center(child: Monogram(size: 40)),
        const SizedBox(height: 6),
        Center(child: Text(l.version(appVersion), style: t.labelSmall?.copyWith(color: BrandColors.muted))),
      ]),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config.dart';
import '../../core/whatsapp_message.dart';
import '../../l10n/gen/app_localizations.dart';
import '../../state/stores.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Fallback when the platform version is unavailable (tests); keep in sync with pubspec.
const appVersion = '1.0.1';

/// Store website pages for the full policies (verified to exist: /privacy, /terms,
/// /returns for Arabic and /en/... for English).
Uri policyUri(String path, String locale) => Uri.parse(AppConfig.resolveUrl(locale == 'en' ? '/en/$path' : '/$path'));

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final locale = context.watch<LocaleStore>();
    final store = context.watch<CatalogStore>().catalog?.store;
    final waUri = whatsAppUri(store?.whatsAppE164);

    Future<void> open(Uri uri, String failMessage) async {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(failMessage)));
      }
    }

    void info(String title, String body, {String? webPath}) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (ctx) => _InfoSheet(
        title: title,
        body: body,
        onWebsite: webPath == null ? null : () => open(policyUri(webPath, locale.code), l.loadError),
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(l.navSettings)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          _Section(
            title: l.settingsPreferences,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.language, color: BrandColors.forest, size: 22),
                        const SizedBox(width: 16),
                        Expanded(child: Text(l.settingsLanguage, style: Theme.of(context).textTheme.bodyLarge)),
                      ],
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<String>(
                        segments: [
                          ButtonSegment(value: 'ar', label: Text(l.arabic)),
                          ButtonSegment(value: 'en', label: Text(l.english)),
                        ],
                        selected: {locale.code},
                        onSelectionChanged: (s) => locale.set(s.first),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          _Section(
            title: l.settingsShopping,
            children: [
              _Row(
                icon: Icons.local_shipping_outlined,
                title: l.deliveryTitle,
                subtitle: l.deliveryNote,
                onTap: () => info(l.deliveryTitle, l.deliveryBody),
              ),
              _Row(
                icon: Icons.chat_bubble_outline,
                title: l.orderingTitle,
                onTap: () => info(l.orderingTitle, l.termsBody),
              ),
            ],
          ),
          if (waUri != null)
            _Section(
              title: l.settingsSupport,
              children: [
                _Row(
                  icon: Icons.support_agent,
                  title: l.contactWhatsApp,
                  subtitle: store?.whatsAppE164,
                  subtitleLtr: true,
                  trailing: const Icon(Icons.open_in_new, size: 18, color: BrandColors.muted),
                  onTap: () => open(waUri, l.whatsAppUnavailable),
                ),
              ],
            ),
          _Section(
            title: l.settingsLegal,
            children: [
              _Row(
                icon: Icons.privacy_tip_outlined,
                title: l.privacyTitle,
                onTap: () => info(l.privacyTitle, l.privacyBody, webPath: 'privacy'),
              ),
              _Row(
                icon: Icons.description_outlined,
                title: l.termsTitle,
                onTap: () => info(l.termsTitle, l.termsBody, webPath: 'terms'),
              ),
              _Row(
                icon: Icons.assignment_return_outlined,
                title: l.returnsTitle,
                onTap: () => info(l.returnsTitle, l.returnsBody, webPath: 'returns'),
              ),
            ],
          ),
          _Section(
            title: l.settingsAbout,
            children: [
              ListTile(
                leading: const BrandLogo(size: 40),
                title: const Text('MAYTHA MARKET', textDirection: TextDirection.ltr),
                subtitle: const _VersionText(),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _VersionText extends StatefulWidget {
  const _VersionText();
  @override
  State<_VersionText> createState() => _VersionTextState();
}

class _VersionTextState extends State<_VersionText> {
  String _version = appVersion;

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform()
        .then((info) {
          if (mounted && info.version.isNotEmpty) {
            setState(() => _version = '${info.version} (${info.buildNumber})');
          }
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) =>
      Text(AppLocalizations.of(context).version(_version), key: const ValueKey('app-version'));
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const Divider(indent: 56));
      rows.add(children[i]);
    }
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 4, bottom: 6),
            child: Semantics(
              header: true,
              child: Text(
                title,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(color: BrandColors.muted, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(children: rows),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.subtitleLtr = false,
    this.trailing,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool subtitleLtr;
  final Widget? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icon, size: 22),
    title: Text(title),
    subtitle: subtitle == null
        ? null
        : Text(
            subtitle!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textDirection: subtitleLtr ? TextDirection.ltr : null,
            textAlign: subtitleLtr ? TextAlign.start : null,
          ),
    trailing: trailing ?? const Icon(Icons.chevron_right, color: BrandColors.muted, size: 20),
    onTap: onTap,
  );
}

class _InfoSheet extends StatelessWidget {
  const _InfoSheet({required this.title, required this.body, this.onWebsite});
  final String title;
  final String body;
  final VoidCallback? onWebsite;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = Theme.of(context).textTheme;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.75),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(header: true, child: Text(title, style: t.titleMedium)),
              const SizedBox(height: 10),
              Text(body, style: t.bodyLarge),
              if (onWebsite != null) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: onWebsite,
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: Text(l.openOnWebsite),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

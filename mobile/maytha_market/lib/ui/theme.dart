import 'package:flutter/material.dart';

/// Brand tokens derived from the official MAYTHA MARKET logo
/// (see docs/design/maytha-tokens.md — shared with the website).
class BrandColors {
  /// Primary: the logo's deep forest green (roof, cart, wordmark).
  static const forest = Color(0xFF0B5A2C);

  /// Darkest green from the logo shading — headings and dark surfaces.
  static const deepGreen = Color(0xFF0A3D1F);

  /// Accent: the fresh leaf green.
  static const leaf = Color(0xFF3E8E3A);
  static const leafOnDark = Color(0xFFA8D5A2);

  /// Tinted container (selected chips, image placeholders).
  static const sage = Color(0xFFE6F0E3);

  /// App background: the logo's warm off-white.
  static const ivory = Color(0xFFF8FAF5);
  static const surface = Colors.white;
  static const hairline = Color(0xFFE1E7DD);
  static const text = Color(0xFF13261B);
  static const muted = Color(0xFF5A6B60);
}

class Radii {
  static const sm = 10.0;
  static const md = 14.0;
  static const lg = 20.0;
}

/// Largest text scale the layouts are designed for. Text still grows with the
/// system setting up to this value; beyond it, Arabic display text made grid
/// cells and app bars unusable on 360dp phones (see device screenshots).
/// Layouts themselves are flexible and tested at 1.5 without the clamp.
const double kMaxTextScale = 1.3;

/// One typography scale. Line heights are explicit so layouts can compute
/// text block heights (see ProductSliverGrid).
const _textTheme = TextTheme(
  headlineSmall: TextStyle(fontSize: 22, height: 1.3, fontWeight: FontWeight.w700, color: BrandColors.text),
  titleLarge: TextStyle(fontSize: 19, height: 1.3, fontWeight: FontWeight.w700, color: BrandColors.text),
  titleMedium: TextStyle(fontSize: 16, height: 1.35, fontWeight: FontWeight.w700, color: BrandColors.text),
  titleSmall: TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w700, color: BrandColors.text),
  bodyLarge: TextStyle(fontSize: 15, height: 1.5, color: BrandColors.text),
  bodyMedium: TextStyle(fontSize: 14, height: 1.45, color: BrandColors.text),
  bodySmall: TextStyle(fontSize: 12.5, height: 1.4, color: BrandColors.muted),
  labelLarge: TextStyle(fontSize: 14, height: 1.3, fontWeight: FontWeight.w600),
  labelMedium: TextStyle(fontSize: 12.5, height: 1.3, fontWeight: FontWeight.w500),
  labelSmall: TextStyle(fontSize: 11.5, height: 1.3, fontWeight: FontWeight.w500),
);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: BrandColors.forest, brightness: Brightness.light).copyWith(
    primary: BrandColors.forest,
    onPrimary: Colors.white,
    primaryContainer: BrandColors.sage,
    onPrimaryContainer: BrandColors.deepGreen,
    secondary: BrandColors.leaf,
    onSecondary: Colors.white,
    secondaryContainer: BrandColors.sage,
    onSecondaryContainer: BrandColors.deepGreen,
    surface: BrandColors.ivory,
    onSurface: BrandColors.text,
    onSurfaceVariant: BrandColors.muted,
    outline: BrandColors.hairline,
    outlineVariant: BrandColors.hairline,
  );
  const hairline = BorderSide(color: BrandColors.hairline);
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    textTheme: _textTheme,
    scaffoldBackgroundColor: BrandColors.ivory,
    appBarTheme: AppBarTheme(
      backgroundColor: BrandColors.ivory,
      foregroundColor: BrandColors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: _textTheme.titleMedium,
    ),
    cardTheme: CardThemeData(
      color: BrandColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md), side: hairline),
    ),
    dividerTheme: const DividerThemeData(color: BrandColors.hairline, thickness: 1, space: 1),
    listTileTheme: ListTileThemeData(
      iconColor: BrandColors.forest,
      titleTextStyle: _textTheme.bodyLarge,
      subtitleTextStyle: _textTheme.bodySmall,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 50),
        shape: rounded,
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: rounded,
        side: const BorderSide(color: BrandColors.forest),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: BrandColors.surface,
      selectedColor: BrandColors.sage,
      side: hairline,
      labelStyle: _textTheme.labelLarge?.copyWith(color: BrandColors.text),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BrandColors.surface,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.md), borderSide: hairline),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.md), borderSide: hairline),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.md),
        borderSide: const BorderSide(color: BrandColors.forest, width: 1.5),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: BrandColors.surface,
      indicatorColor: BrandColors.sage,
      elevation: 0,
      labelTextStyle: WidgetStatePropertyAll(_textTheme.labelSmall),
    ),
    snackBarTheme: const SnackBarThemeData(backgroundColor: BrandColors.deepGreen, behavior: SnackBarBehavior.floating),
  );
}

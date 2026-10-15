import 'package:flutter/material.dart';

class BrandColors {
  static const forest = Color(0xFF183D32);
  static const deepGreen = Color(0xFF102F26);
  static const sage = Color(0xFFDDE8DF);
  static const ivory = Color(0xFFF7F5EF);
  static const leaf = Color(0xFF6F9F80);
  static const leafOnDark = Color(0xFFA9C9B2);
  static const hairline = Color(0xFFE3E1D9);
  static const muted = Color(0xFF5B6B63);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: BrandColors.forest,
    brightness: Brightness.light,
  ).copyWith(
    primary: BrandColors.forest,
    onPrimary: Colors.white,
    primaryContainer: BrandColors.sage,
    onPrimaryContainer: BrandColors.deepGreen,
    secondary: BrandColors.deepGreen,
    secondaryContainer: BrandColors.sage,
    onSecondaryContainer: BrandColors.deepGreen,
    surface: BrandColors.ivory,
    onSurface: BrandColors.deepGreen,
    onSurfaceVariant: BrandColors.muted,
    outline: BrandColors.hairline,
    outlineVariant: BrandColors.hairline,
  );
  const hairline = BorderSide(color: BrandColors.hairline);
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: BrandColors.ivory,
    appBarTheme: const AppBarTheme(
      backgroundColor: BrandColors.ivory,
      foregroundColor: BrandColors.deepGreen,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: hairline),
    ),
    dividerTheme: const DividerThemeData(color: BrandColors.hairline, thickness: 1, space: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: rounded,
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
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
      backgroundColor: Colors.white,
      selectedColor: BrandColors.sage,
      side: hairline,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: hairline),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: hairline),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BrandColors.forest, width: 1.5),
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: BrandColors.sage,
      elevation: 0,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: BrandColors.deepGreen,
      behavior: SnackBarBehavior.floating,
    ),
  );
}

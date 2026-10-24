# MAYTHA MARKET design tokens

Derived from the official logo (`mobile/maytha_market/assets/brand/logo-original.png`,
sampled with sharp). Source of truth for the Flutter app: `mobile/maytha_market/lib/ui/theme.dart`.

## Colour

| Token            | Hex       | Use                                                                     |
| ---------------- | --------- | ----------------------------------------------------------------------- |
| primary (forest) | `#0B5A2C` | logo roof/cart/wordmark green; buttons, prices, selected states         |
| primary-deep     | `#0A3D1F` | darkest logo shade; snackbars, dark surfaces                            |
| accent (leaf)    | `#3E8E3A` | logo leaf green; brand labels, small highlights                         |
| accent-on-dark   | `#A8D5A2` | accent text on primary backgrounds                                      |
| container (sage) | `#E6F0E3` | selected chips, image placeholders                                      |
| background       | `#F8FAF5` | logo's warm off-white; app background, splash, adaptive icon background |
| surface          | `#FFFFFF` | cards, sheets, bars                                                     |
| border           | `#E1E7DD` | hairlines (1px)                                                         |
| text             | `#13261B` | body and headings                                                       |
| text-muted       | `#5A6B60` | secondary text                                                          |

## Shape and elevation

Radius: sm 10, md 14 (cards, inputs, buttons), lg 20 (hero). Shadows: none; separation by 1px border.

## Typography (dp / line-height)

headlineSmall 22/1.3 w700 · titleLarge 19/1.3 w700 · titleMedium 16/1.35 w700 · titleSmall 14/1.35 w700 ·
bodyLarge 15/1.5 · bodyMedium 14/1.45 · bodySmall 12.5/1.4 · labelLarge 14/1.3 w600 · labelMedium 12.5/1.3 · labelSmall 11.5/1.3.
Font: platform default (Roboto / Noto Naskh Arabic on Android, SF / SF Arabic on iOS); the app bundles no fonts.
Text scale: respected up to 1.3x (`kMaxTextScale`); layouts are tested at 1.5x.

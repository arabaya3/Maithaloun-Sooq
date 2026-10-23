# Tablet screenshots (7-inch) — not produced

The app has no tablet layout: only the product grid adapts (`maxCrossAxisExtent: 220`); every other
screen is the phone layout stretched to full width. On a Pixel Tablet emulator (2560x1600, Android 36)
the product details screen showed the product image filling the whole screen with the title, price and
variants pushed below the fold. Tablet screenshots are optional on Google Play, so none are uploaded
rather than showing a stretched phone UI. A 7-inch profile was not emulated separately: the same non-adaptive layout code applies at every width. Revisit after an adaptive layout is built.

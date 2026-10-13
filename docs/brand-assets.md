# Storefront brand and photography assets

Every third-party image the storefront ships, with where it came from and the terms it is used under. Files are stored locally and shown unaltered. Photos are cropped and resized only.

## Brand logos (`public/brands/logos/`)

These are shown only on the brand tiles and brand pages of brands the store stocks. They identify the brand and do not imply endorsement. Each file matches the SHA-1 that Wikimedia Commons publishes for it.

| Brand                  | File                     | Source                                                            | Commons licence                        | SHA-1                                    |
| ---------------------- | ------------------------ | ----------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Clear (Unilever)       | `clear.svg`              | https://commons.wikimedia.org/wiki/File:Clear-logo.svg            | Public domain (text logo), trademarked | b48f65f618a3a856597f9ef79a57efd88cfb647c |
| AXE (Unilever)         | `axe.svg`                | https://commons.wikimedia.org/wiki/File:AXE_logo_2021.svg         | Public domain (text logo), trademarked | 79b4ebab16f81cead82b8f7e558278aceeafde86 |
| Head & Shoulders (P&G) | `head-and-shoulders.svg` | https://commons.wikimedia.org/wiki/File:Head%26shoulders-Logo.svg | Public domain (text logo), trademarked | f106471adc01bb49e75ef447b603a198eeaae9a8 |
| Signal (Unilever)      | `signal.svg`             | https://commons.wikimedia.org/wiki/File:Signal_(2016).svg         | Public domain (text logo), trademarked | 3a5e68c8ab35a11542309e513f07ec2a973004f3 |
| Sunsilk (Unilever)     | `sunsilk.png`            | https://commons.wikimedia.org/wiki/File:Sunsilk_(2022).png        | Public domain (text logo), trademarked | 3de9f0d5c74e4508efadf5082ffc3850d68bdaf6 |

All other brands appear as a typographic wordmark of the name the owner entered. Logos were left out where no file could be verified, or where the only available file was licensed for Wikipedia use only (Ariel, Pampers) or its licence claim was doubtful (Finish, Dove). To add one, put the official file in `public/brands/logos/` and register it in `src/features/storefront/brand-logos.ts`.

## Lifestyle photography (`public/assets/lifestyle/`)

All photos are used under the [Unsplash License](https://unsplash.com/license): free for commercial use, no attribution required (credited here anyway). They are not sold as photos and not presented as the store's own products.

| File                   | Photo                                                                                          | Photographer     | Edit                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------- |
| `laundry-room.webp`    | https://unsplash.com/photos/a-washer-and-dryer-in-a-room-23coWmkTNSg                           | PlanetCare       | Cropped to leave out a branded water filter; resized |
| `kitchen-window.webp`  | https://unsplash.com/photos/grey-transistor-radio-jECR38r5sEE                                  | Harry Grout      | Cropped; resized                                     |
| `folded-textiles.webp` | https://unsplash.com/photos/white-and-black-floral-textile-on-brown-woven-armchair-eN9atEtVtcc | Vladimir Gladkov | Resized                                              |

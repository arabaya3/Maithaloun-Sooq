---
name: maytha-image-to-code
description: Implement a screen from a supplied screenshot, mockup or design image. Use when the user gives an image or Figma frame to build from.
disable-model-invocation: true
---

# Image to code

Claude reads images directly; Figma frames go through the figma plugin. No other tool is needed.

1. Read the image. List its layout, type scale, colours and states; ask about anything it does not show (errors, empty, loading).
2. Find the existing components and the tokens in `src/app/globals.css`. Reuse them; add a component only when none fits.
3. A reference shows layout and hierarchy. Keep MAYTHA's brand, prices, products and text; never copy another brand's identity.
4. Do not change business logic, prices, delivery or checkout behaviour to match a picture.
5. Build Arabic RTL first, then check English LTR.
6. Compare screenshots at 390px and 1440px with the image, list the remaining differences, and run `web-design-guidelines`.

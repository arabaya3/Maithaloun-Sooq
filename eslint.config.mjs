import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "playwright-report/**",
    "public/sw.js",
    // The Flutter app has its own tooling; Prettier skips it too.
    "mobile/**",
    // Vendored third-party skill, kept as upstream wrote it.
    ".claude/skills/design-taste-frontend/**",
  ]),
]);

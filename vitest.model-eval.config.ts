import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Paid, opt-in: runs only with ASSISTANT_MODEL_EVAL=1, an OpenAI key and a local test database.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "src/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/model-eval/**/*.eval.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
  },
});

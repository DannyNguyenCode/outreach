import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    setupFiles: ["./tests/integration/setup.ts"],
  },
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": path.join(rootDir, "tests/shims/server-only.ts"),
    },
  },
});

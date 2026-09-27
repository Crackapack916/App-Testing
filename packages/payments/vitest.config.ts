import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Reuses the database package's migrated template.
    globalSetup: "../db/test/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

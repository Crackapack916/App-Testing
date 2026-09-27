import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const PORT = 8788;
// Use the container's preinstalled Chromium when the pinned Playwright build is absent.
const chromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite build && npx tsx e2e/serve.ts",
    url: `http://localhost:${PORT}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
});

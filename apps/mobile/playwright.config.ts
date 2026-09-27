import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const API = 8789;
const WEB = 8790;
const chromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${WEB}`,
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://localhost:${API} npx expo export --platform web --output-dir dist --clear && npx tsx e2e/serve.mts`,
    url: `http://localhost:${API}/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { E2E_API_PORT: String(API), E2E_WEB_PORT: String(WEB) },
  },
});

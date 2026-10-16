import { defineConfig, devices } from "@playwright/test"
import { APP_URL } from "./test-support/e2e/constants.mjs"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: ["screenshots.spec.ts", "debug-session.spec.ts"],
  // The local stub has one scenario at a time; contexts still isolate browser data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node test-support/e2e/start-server.mjs",
    url: `${APP_URL}/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
})

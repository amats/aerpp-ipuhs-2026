import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: true,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3113", headless: true },
  webServer: {
    command: "node scripts/start-information-test.mjs",
    cwd: import.meta.dirname,
    url: "http://127.0.0.1:3113/information",
    timeout: 120_000,
    reuseExistingServer: false,
  },
})

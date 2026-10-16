import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: { headless: true },
  reporter: "list",
})

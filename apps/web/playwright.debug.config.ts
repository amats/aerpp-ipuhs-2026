import { defineConfig } from "@playwright/test"
import config from "./playwright.config"

export default defineConfig({
  ...config,
  testMatch: "debug-session.spec.ts",
  testIgnore: "screenshots.spec.ts",
  webServer: {
    ...config.webServer,
    command: "node test-support/e2e/start-server.mjs --debug",
  },
})

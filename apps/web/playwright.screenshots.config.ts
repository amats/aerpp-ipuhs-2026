import path from "node:path"
import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.config"

const outputDirectory = process.env.AERPP_SCREENSHOT_DIR
if (!outputDirectory) throw new Error("Run pnpm run screenshots")

export default defineConfig({
  ...baseConfig,
  testMatch: "screenshots.spec.ts",
  testIgnore: [],
  timeout: 120_000,
  reporter: [["list"]],
  outputDir: path.join(outputDirectory, "test-results"),
  projects: [{ name: "desktop-chromium" }],
  use: {
    ...baseConfig.use,
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "off",
    screenshot: "off",
  },
})

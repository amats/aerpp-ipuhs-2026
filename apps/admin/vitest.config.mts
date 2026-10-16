import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@aerpp-surveys": fileURLToPath(
        new URL("../../config/common/survey", import.meta.url),
      ),
    },
  },
  test: {
    allowOnly: false,
    environment: "node",
    include: ["**/*.test.{ts,tsx,mjs}"],
  },
})

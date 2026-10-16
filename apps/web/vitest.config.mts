import path from "node:path"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@/assets": path.resolve(import.meta.dirname, "./assets-public"),
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(
        import.meta.dirname,
        "./test-support/server-only.ts",
      ),
    },
  },
  test: {
    allowOnly: false,
    environment: "node",
    exclude: [
      ...configDefaults.exclude,
      ".next/**",
      ".playwright/**",
      "e2e/**",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
})

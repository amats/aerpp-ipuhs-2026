import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    allowOnly: false,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
})

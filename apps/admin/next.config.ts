import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assertNoAppEnvFiles } from "@aerpp/config/process"
import type { NextConfig } from "next"
import { PHASE_PRODUCTION_SERVER } from "next/constants"
import { assertAdminBuildEnvironment } from "./scripts/build-environment.mjs"

assertNoAppEnvFiles(fileURLToPath(new URL(".", import.meta.url)))

export default function nextConfig(phase: string): NextConfig {
  const environment = process.env.AERPP_ENVIRONMENT || "local"
  if (phase === PHASE_PRODUCTION_SERVER) {
    assertAdminBuildEnvironment(
      environment,
      readFileSync(new URL("./.next/BUILD_ID", import.meta.url), "utf8").trim(),
    )
  }
  return {
    output: "standalone",
    reactCompiler: true,
    // A 1 MB UTF-8 message can expand sixfold when JSON escapes control characters.
    experimental: { serverActions: { bodySizeLimit: "8mb" } },
    serverExternalPackages: ["@google-cloud/firestore"],
    outputFileTracingIncludes: {
      "/*": ["../../packages/documents/fonts/*.ttf"],
      "/license": ["./generated/licenses/**/*"],
    },
    outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
    outputFileTracingExcludes: {
      "/*": [
        "../../**/private/**/*",
        "../../generated/**/*",
        "../../**/secrets/**/*",
        "../../config/!(example|common)/**/*",
        "../../**/.env*",
        "../../.git/**/*",
        "../../**/*.test.*",
        "../../**/test-support/**/*",
        "../../**/tests/**/*",
        "../../**/e2e/**/*",
      ],
    },
    generateBuildId: async () => `aerpp-${environment}-${randomUUID()}`,
    turbopack: {
      root: fileURLToPath(new URL("../..", import.meta.url)),
    },
  }
}

import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { assertNoAppEnvFiles } from "@aerpp/config/process"
import createMDX from "@next/mdx"
import type { NextConfig } from "next"
import { assertResearchAssets } from "./scripts/image-inputs.mjs"
import { BROWSER_PAYLOAD_CONSTRAINTS } from "./src/lib/browser-payload-constraints.mjs"
import {
  readResearchDocumentSet,
  researchAssetsDirectory,
} from "./src/lib/research-assets.mjs"

assertNoAppEnvFiles(fileURLToPath(new URL(".", import.meta.url)))
const assetsDirectory = researchAssetsDirectory(process.cwd())
assertResearchAssets(assetsDirectory)
const assetSource = basename(assetsDirectory)

const nextConfig: NextConfig = {
  logging: {
    // Server Function arguments include email and sealed session payloads.
    serverFunctions: false,
    incomingRequests: {
      ignore: [/^\/api\/llm\/analysis(?:\?|$)/],
    },
  },
  env: {
    AERPP_WEB_ASSET_SOURCE: assetSource,
    AERPP_WEB_DOCUMENT_SET: JSON.stringify(
      readResearchDocumentSet(process.cwd(), assetsDirectory).reference,
    ),
  },
  // Caddy owns response compression; Next's bundled middleware leaks drain listeners.
  // https://github.com/expressjs/compression/issues/152
  compress: false,
  output: "standalone",
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
      "./assets/*.docx",
      "./assets/*.doc",
      "./assets/*.odt",
      "./assets/.DS_Store",
      "./assets-public/*.docx",
      "./assets-public/*.doc",
      "./assets-public/*.odt",
      "./assets-public/.DS_Store",
      `./${assetSource === "assets" ? "assets-public" : "assets"}/**/*`,
    ],
  },
  outputFileTracingIncludes: {
    "/*": [
      "../../config/common/survey/*.json",
      `./${assetSource}/*.pdf`,
      `./${assetSource}/*.mdx`,
      "../../config/common/documents/version.json",
      "../../packages/documents/fonts/*.ttf",
    ],
    "/license": ["./generated/licenses/**/*"],
  },
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: ["@aerpp/participant-api-contracts"],
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  experimental: {
    serverActions: {
      bodySizeLimit: BROWSER_PAYLOAD_CONSTRAINTS.maxActionBodyBytes,
    },
  },
  reactCompiler: true,
  typedRoutes: true,
}

const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: [],
  },
})

export default withMDX(nextConfig)

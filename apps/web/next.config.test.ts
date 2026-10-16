import { describe, expect, it, vi } from "vitest"

vi.mock("./scripts/image-inputs.mjs", () => ({
  assertResearchAssets: () => {},
}))
vi.mock("./src/lib/research-assets.mjs", () => ({
  researchAssetsDirectory: () => "/synthetic/assets-public",
  readResearchDocumentSet: () => ({
    reference: { version: "1.0", sha256: "a".repeat(64) },
  }),
}))

import nextConfig from "./next.config"

describe("development log privacy and noise", () => {
  it("disables invocation logs that expose Server Function arguments", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false })
  })

  it("suppresses the polling endpoint while retaining result and other access logs", () => {
    const logging = nextConfig.logging
    if (
      logging === false ||
      logging === undefined ||
      typeof logging.incomingRequests !== "object"
    ) {
      throw new Error("Expected an incoming-request URL filter")
    }
    const { incomingRequests } = logging
    const ignored = (url: string) =>
      incomingRequests.ignore?.some((pattern) => pattern.test(url)) === true
    expect(ignored("/api/llm/analysis")).toBe(true)
    expect(ignored("/api/llm/analysis?status=current")).toBe(true)
    expect(ignored("/api/llm/analysis/result?analysisId=synthetic")).toBe(false)
    expect(ignored("/api/llm/analysis/cancel")).toBe(false)
    expect(ignored("/api/llm/analysis-other")).toBe(false)
    expect(ignored("/api/documents?name=consent")).toBe(false)
    expect(ignored("/")).toBe(false)
  })
})

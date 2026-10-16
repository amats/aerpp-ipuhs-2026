import { describe, expect, it } from "vitest"
import { validateImageRuntime } from "./start-image.mjs"

const env = {
  AERPP_ENVIRONMENT: "test",
  NODE_ENV: "production",
}
describe("standalone image startup", () => {
  it("checks the built profile without relying on next.config execution", () => {
    expect(() =>
      validateImageRuntime(env, "aerpp-test-synthetic"),
    ).not.toThrow()
    expect(() =>
      validateImageRuntime(env, "aerpp-production-synthetic"),
    ).toThrow()
    expect(() =>
      validateImageRuntime(
        { ...env, AERPP_ENVIRONMENT: "production" },
        "aerpp-test-synthetic",
      ),
    ).toThrow()
  })
  it("rejects development mode and authentication bypass", () => {
    expect(() =>
      validateImageRuntime(
        { ...env, NODE_ENV: "development" },
        "aerpp-test-synthetic",
      ),
    ).toThrow()
    expect(() =>
      validateImageRuntime(
        { ...env, ADMIN_AUTH_BYPASS_ENABLED: "true" },
        "aerpp-test-synthetic",
      ),
    ).toThrow()
  })
})

import { llmConfigSchema } from "@aerpp/config/llm"
import { describe, expect, it } from "vitest"
import { loadLlmConfig, resolveLlmPresetPath } from "./load-llm-config"

describe("load LLM config", () => {
  it("loads the local Med-Gemma config without provider or authentication settings", () => {
    const config = loadLlmConfig()
    expect(config.model).toBe("medgemma-27b-it")
    expect(config.baseUrl).toBe("http://host.docker.internal:1234/v1")
    expect(config.generation).toEqual({
      temperature: 0,
      topP: 1,
      topK: 0,
      repeatPenalty: 1,
      seed: 0,
    })
    expect(config.license.model).toBe("Med-Gemma 27B Instruct")
  })

  it("accepts the config basename", () => {
    expect(loadLlmConfig("lms-medgemma.json")).toEqual(loadLlmConfig())
  })

  it.each([
    "../outside.json",
    "/tmp/outside.json",
    "nested/config.json",
    "../../config/common/llm/lms-medgemma.json",
    "nested\\config.json",
  ])("rejects config paths outside the config directory: %s", (configPath) => {
    expect(() => resolveLlmPresetPath(configPath)).toThrow(
      "LLM_PRESET_FILE must",
    )
  })

  it.each([
    "http://localhost:1234/v1",
    "http://127.0.0.1:1234/v1/",
    "http://[::1]:1234/v1",
    "https://host.docker.internal:1234/v1",
  ])("accepts a local HTTP endpoint: %s", (baseUrl) => {
    expect(
      llmConfigSchema.safeParse({ ...loadLlmConfig(), baseUrl }).success,
    ).toBe(true)
  })

  it.each([
    "https://external.example/v1",
    "http://host.docker.internal.external.example/v1",
    "http://user:password@host.docker.internal:1234/v1",
    "http://host.docker.internal:1234/v1?key=secret",
    "http://host.docker.internal:1234/v1#fragment",
    "http://host.docker.internal:1234/other",
    "ws://host.docker.internal:1234/v1",
    "invalid",
  ])("rejects an unsupported endpoint: %s", (baseUrl) => {
    expect(
      llmConfigSchema.safeParse({ ...loadLlmConfig(), baseUrl }).success,
    ).toBe(false)
  })

  it.each([{ unexpected: true }, { generation: { temperature: 0 } }])(
    "rejects unknown fields or incomplete generation settings: %j",
    (override) => {
      expect(
        llmConfigSchema.safeParse({ ...loadLlmConfig(), ...override }).success,
      ).toBe(false)
    },
  )
})

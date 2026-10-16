import "server-only"

import { readFileSync } from "node:fs"
import { resolveLlmPresetPath } from "@aerpp/config/llm"

export { resolveLlmPresetPath } from "@aerpp/config/llm"

import { type LlmConfig, llmConfigSchema } from "@aerpp/config/llm"

export function loadLlmConfig(presetFile?: string): LlmConfig {
  const resolvedPath = resolveLlmPresetPath(presetFile)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(readFileSync(resolvedPath, "utf-8"))
  } catch (error) {
    throw new Error(`Failed to read LLM config: ${presetFile}`, {
      cause: error,
    })
  }

  const parsedConfig = llmConfigSchema.safeParse(parsedJson)
  if (!parsedConfig.success) {
    throw new Error(`Invalid LLM config: ${presetFile}`, {
      cause: parsedConfig.error,
    })
  }

  return parsedConfig.data
}

import { existsSync, readFileSync } from "node:fs"
import { readOptionalEnvironment } from "./index.mjs"
import {
  DEFAULT_LLM_PRESET_FILE,
  llmConfigSchema,
  resolveLlmPresetPath,
} from "./llm.mjs"
import { validateWebRuntimeEnvironment } from "./web.mjs"

export function validateWebEnvironment(
  source,
  { checkLlm = true, webDirectory = process.cwd() } = {},
) {
  const validationErrors = validateWebRuntimeEnvironment(source)
  const env = {
    LLM_PRESET_FILE: readOptionalEnvironment(source, "LLM_PRESET_FILE"),
  }
  function resolveSelectedLlmConfig() {
    const configPath = env.LLM_PRESET_FILE ?? DEFAULT_LLM_PRESET_FILE
    try {
      return {
        displayPath: configPath,
        resolvedPath: resolveLlmPresetPath(configPath, webDirectory),
      }
    } catch (error) {
      validationErrors.push(error.message)
      return null
    }
  }

  function validateLlmConfig() {
    const resolvedConfig = resolveSelectedLlmConfig()
    if (!resolvedConfig) {
      return
    }

    if (!existsSync(resolvedConfig.resolvedPath)) {
      validationErrors.push(
        `LLM_PRESET_FILE (file not found: ${resolvedConfig.displayPath})`,
      )
      return
    }

    let config
    try {
      config = JSON.parse(readFileSync(resolvedConfig.resolvedPath, "utf-8"))
    } catch {
      validationErrors.push(
        `LLM_PRESET_FILE (invalid JSON: ${resolvedConfig.displayPath})`,
      )
      return
    }

    const parsed = llmConfigSchema.safeParse(config)
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        validationErrors.push(`LLM config ${issue.path.join(".") || "root"}`)
  }

  if (checkLlm) validateLlmConfig()
  return [...new Set(validationErrors)]
}

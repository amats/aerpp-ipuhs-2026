import path from "node:path"
import { z } from "zod"

export const LLM_CONFIG_DIRECTORY = "../../config/common/llm"
export const DEFAULT_LLM_PRESET_FILE = "lms-medgemma.json"

// Resolve from the Web working directory, including standalone and isolated test builds.
export function resolveLlmPresetPath(
  presetFile = DEFAULT_LLM_PRESET_FILE,
  webDirectory = process.cwd(),
) {
  if (path.isAbsolute(presetFile)) {
    throw new Error("LLM_PRESET_FILE must be a filename")
  }

  if (
    !presetFile ||
    path.basename(presetFile) !== presetFile ||
    presetFile.includes("\\")
  ) {
    throw new Error(
      `LLM_PRESET_FILE must name a file in ${LLM_CONFIG_DIRECTORY}`,
    )
  }

  return path.join(
    /*turbopackIgnore: true*/ webDirectory,
    LLM_CONFIG_DIRECTORY,
    presetFile,
  )
}

// Only the Docker host and loopback endpoints are supported for local inference.
export function isLocalLmStudioUrl(value) {
  try {
    const url = new URL(value)
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["host.docker.internal", "localhost", "127.0.0.1", "[::1]"].includes(
        url.hostname,
      ) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["/v1", "/v1/"].includes(url.pathname)
    )
  } catch {
    return false
  }
}

export const llmConfigSchema = z.strictObject({
  model: z.string().trim().min(1),
  baseUrl: z
    .string()
    .refine(isLocalLmStudioUrl, "Expected a local LM Studio HTTP /v1 endpoint"),
  generation: z.strictObject({
    temperature: z.number(),
    topP: z.number(),
    topK: z.number(),
    repeatPenalty: z.number(),
    seed: z.number(),
  }),
  prompt: z.strictObject({
    system: z.string().refine((value) => value.trim() !== "", {
      message: "Expected nonblank system instructions",
    }),
    header: z.string(),
    footer: z.string(),
  }),
  license: z.strictObject({
    model: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    licenseName: z.string().trim().min(1),
    link: z.string().url(),
    note: z.string().trim().min(1),
  }),
})

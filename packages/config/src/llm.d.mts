import type { z } from "zod"

export const LLM_CONFIG_DIRECTORY: string
export const DEFAULT_LLM_PRESET_FILE: string
export function resolveLlmPresetPath(
  presetFile?: string,
  webDirectory?: string,
): string

export function isLocalLmStudioUrl(value: string): boolean

export const llmConfigSchema: z.ZodType<{
  model: string
  baseUrl: string
  generation: {
    temperature: number
    topP: number
    topK: number
    repeatPenalty: number
    seed: number
  }
  prompt: { system: string; header: string; footer: string }
  license: {
    model: string
    provider: string
    licenseName: string
    link: string
    note: string
  }
}>
export type LlmConfig = z.infer<typeof llmConfigSchema>

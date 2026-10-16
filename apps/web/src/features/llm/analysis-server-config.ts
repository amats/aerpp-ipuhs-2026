import "server-only"

import { readOptionalEnv } from "@aerpp/config/server/web"
import { loadLlmConfig } from "@/features/llm/load-llm-config"

export const LLM_CONFIG = loadLlmConfig(readOptionalEnv("LLM_PRESET_FILE"))

export const ANALYSIS_PROMPT = LLM_CONFIG.prompt

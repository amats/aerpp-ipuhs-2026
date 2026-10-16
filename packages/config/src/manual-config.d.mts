import type { ProfileConfig } from "./profiles.mjs"
export function decodeManualConfig(config: unknown): ProfileConfig
export function encodeManualConfig(
  config: ProfileConfig,
): Record<string, unknown>

import { z } from "zod"

export const AlertTone = {
  info: "info",
  warning: "warning",
  error: "error",
  success: "success",
} as const

export const alertToneSchema = z.enum(AlertTone)
export type AlertTone = z.infer<typeof alertToneSchema>

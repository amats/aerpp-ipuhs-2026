import type { z } from "zod"
import { throwApiError } from "./api-errors.js"

export function parseApiRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success !== true)
    return throwApiError(400, "INVALID_REQUEST", "invalid request")
  return result.data
}

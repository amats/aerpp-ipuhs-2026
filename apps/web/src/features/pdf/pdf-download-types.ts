import { z } from "zod"

export const pdfDownloadResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    contentBase64: z.string().min(1),
    filename: z.string().min(1),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type PdfDownloadResult = z.infer<typeof pdfDownloadResultSchema>

export const documentRequestSchema = z
  .object({
    name: z.enum(["explanation", "plan", "consent", "withdrawal", "history"]),
    recordId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((input) => input.name !== "history" || input.recordId === undefined)

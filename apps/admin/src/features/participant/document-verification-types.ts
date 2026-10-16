import { z } from "zod"

export const documentVerificationInputSchema = z
  .object({
    email: z
      .string()
      .trim()
      .refine(
        (value) =>
          z.email().safeParse(value.toLowerCase().normalize("NFKC")).success ===
          true,
      ),
    date: z.iso.date(),
    purpose: z.enum(["consent", "withdrawal"]),
    did: z
      .string()
      .trim()
      .regex(/^aerpp:did-[a-f0-9]{32}$/),
    version: z
      .string()
      .regex(/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/)
      .max(32),
    sha256: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/),
    requestId: z.string().regex(/^\d{1,12}$/),
  })
  .strict()

export type DocumentVerificationState = {
  message: string
  requestId?: string
  matched?: boolean
  pseudonym?: string
  archiveVerified?: boolean
  receiptMatched?: boolean
}

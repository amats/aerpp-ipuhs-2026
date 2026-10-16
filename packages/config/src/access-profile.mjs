import { z } from "zod"

const accessSchema = z
  .object({
    notBefore: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    backendStopsAt: z.iso.datetime({ offset: true }),
    revoked: z.boolean(),
  })
  .strict()
  .refine(
    (value) => {
      const start = Date.parse(value.notBefore)
      const end = Date.parse(value.expiresAt)
      return (
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        end > start
      )
    },
    {
      message: "Access expiry must follow its nonnegative start time",
      path: ["expiresAt"],
    },
  )
  .refine(
    (value) => Date.parse(value.backendStopsAt) >= Date.parse(value.expiresAt),
    {
      message: "Backend stop must not precede Web reception expiry",
      path: ["backendStopsAt"],
    },
  )

export function readAccessProfile(input) {
  const parsed = accessSchema.safeParse(input)
  if (parsed.success !== true)
    throw new Error(
      `Configure support.access fields: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "access"))].join(", ")}`,
    )
  return parsed.data
}

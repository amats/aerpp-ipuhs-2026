import { AddInformationRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const InformationInputSchema = AddInformationRequestSchema
export type InformationInput = z.infer<typeof InformationInputSchema>
export const InformationTargetSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(1500)
      .refine(
        (value) =>
          !value.includes("/") &&
          value !== "." &&
          value !== ".." &&
          !/^__.*__$/.test(value) &&
          new TextEncoder().encode(value).length <= 1500,
      ),
    version: z
      .object({
        seconds: z.number().int().min(0).max(253402300799),
        nanoseconds: z.number().int().min(0).max(999999999),
      })
      .strict(),
  })
  .strict()
export type InformationTarget = z.infer<typeof InformationTargetSchema>
export const InformationRecordSchema = InformationTargetSchema.extend({
  ...InformationInputSchema.required().shape,
  createdAt: z.iso.datetime(),
})
export type InformationRecord = z.infer<typeof InformationRecordSchema>
export type InformationMutationResult =
  | { ok: true }
  | { ok: false; code: "conflict" | "not_found" }

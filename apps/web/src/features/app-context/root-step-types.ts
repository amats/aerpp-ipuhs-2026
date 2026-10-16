import { z } from "zod"

// Visible section on the home route; participation eligibility is tracked by Stage.
export const RootStep = {
  start: "start",
  explanation: "explanation",
  consent: "consent",
  auth: "auth",
  document: "document",
  result: "result",
  survey: "survey",
  thanks: "thanks",
  withdrawn: "withdrawn",
} as const

export const rootStepSchema = z.enum(RootStep)
export type RootStep = z.infer<typeof rootStepSchema>

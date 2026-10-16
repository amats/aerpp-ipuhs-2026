import { z } from "zod"

export const Stage = {
  unauthenticated: "unauthenticated",
  confirmationSent: "confirmation_sent",
  // Authentication is verified, but the participant has not submitted a survey.
  authenticated: "authenticated",
  withdrawn: "withdrawn",
  // At least one survey was submitted; further analyses use the follow-up survey.
  // This does not mean the current analysis or its survey has finished.
  followUp: "follow_up",
} as const

export const stageSchema = z.enum(Stage)
export type Stage = z.infer<typeof stageSchema>

import { WithdrawParticipationRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"
import { isSessionGeneration } from "./session-generation"

const identifier = z.string().min(1).max(256)

// Explicit persistence allowlists. Analysis content and questionnaire answers
// cannot enter either the ordinary state or the encrypted operational context.
export const sessionStateSchema = z
  .object({
    stateRevision: z.number().int().nonnegative().optional(),
    serverId: identifier.optional(),
    questionnaireKind: z.enum(["initial", "follow-up"]).optional(),
    adminRecoveryPseudonym: identifier.optional(),
    adminRecoveryId: z.uuid().optional(),
    adminRecoveryCleanupPending: z.boolean().optional(),
    recoveredSurveyAnalysisId: identifier.optional(),
    coordinationId: z.string().refine(isSessionGeneration).optional(),
    presentedAnalysisId: identifier.optional(),
    submittedAnalysisId: identifier.optional(),
    pendingSurveyAnalysisId: identifier.optional(),
    clientId: identifier.optional(),
    consentId: identifier.optional(),
    lastConsentMailAt: z.number().int().nonnegative().optional(),
    lastConsentMailId: identifier.optional(),
    pseudonym: identifier.optional(),
    withdrawalCleanupCompleted: z.boolean().optional(),
    authVerifiedAt: z.iso.datetime().optional(),
    stage: identifier.optional(),
    rootStep: identifier.optional(),
    activeAnalysisId: identifier.optional(),
    lastCompletedAnalysisId: identifier.optional(),
  })
  .strict()

export const sessionPrivateSchema = z
  .object({
    email: z.email().max(320).optional(),
    preparedConsentContext: z.string().max(16_384).optional(),
    withdrawalRequest: WithdrawParticipationRequestSchema.optional(),
  })
  .strict()

export const sessionDataSchema = sessionStateSchema
  .extend(sessionPrivateSchema.shape)
  .strict()

export type SessionData = z.infer<typeof sessionDataSchema>

export function normalizeSessionView(state: Record<string, unknown>) {
  return {
    ...state,
    rootStep:
      !state.adminRecoveryId &&
      state.stage === "unauthenticated" &&
      ["start", "explanation", "consent"].includes(String(state.rootStep))
        ? "start"
        : state.rootStep === "survey" && !state.recoveredSurveyAnalysisId
          ? "result"
          : state.rootStep,
  }
}

export function splitSessionData(data: SessionData) {
  const { email, preparedConsentContext, withdrawalRequest, ...state } =
    sessionDataSchema.parse(data)
  return {
    state: sessionStateSchema.parse(normalizeSessionView(state)),
    privateState: sessionPrivateSchema.parse({
      email,
      preparedConsentContext,
      withdrawalRequest,
    }),
  }
}

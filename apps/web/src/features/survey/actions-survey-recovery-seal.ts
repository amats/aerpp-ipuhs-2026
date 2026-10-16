"use server"

import { env } from "@aerpp/config/server/web"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import { withSessionRead } from "@/features/session/session-operation"
import { BROWSER_PAYLOAD_CONSTRAINTS as limits } from "@/lib/browser-payload-constraints.mjs"
import { safeParseApiRequest } from "@/lib/participant-api-contract-helpers"
import { getSession } from "@/lib/session"
import { sealSessionData, unsealSessionData } from "@/lib/session-seal"
import { validateSurveySubmissionInput } from "./survey-answer-validation"
import { recoveredSurveyDraftSchema } from "./survey-recovery-types"

export async function sealRecoveredSurveyDraftAction(
  value: unknown,
  token?: string,
) {
  return withSessionRead(token, async () => {
    const session = await getSession()
    const parsed = recoveredSurveyDraftSchema.safeParse(value)
    if (
      parsed.success !== true ||
      !session.authVerifiedAt ||
      !session.consentId ||
      session.recoveredSurveyAnalysisId !== parsed.data.analysisId ||
      session.lastCompletedAnalysisId !== parsed.data.analysisId
    )
      return { ok: false as const, reason: "survey_invalid" }
    const submission = validateSurveySubmissionInput({
      stage: readStageFromSession(session),
      survey: parsed.data.answers,
      definitionId: parsed.data.definitionId,
    })
    if (
      !submission ||
      safeParseApiRequest("submitSurvey", {
        ...submission,
        analysisId: parsed.data.analysisId,
        serverId: env.participantApiServerId,
        clientId: session.clientId,
        pseudonym: session.pseudonym,
        consentId: session.consentId,
      }).success !== true
    )
      return { ok: false as const, reason: "survey_invalid" }
    const envelope = {
      purpose: "recovered-survey",
      consentId: session.consentId,
      coordinationId: session.coordinationId,
      draft: parsed.data,
    }
    if (
      new TextEncoder().encode(JSON.stringify(envelope)).byteLength >
      limits.maxEnvelopeBytes
    )
      return { ok: false as const, reason: "seal_failed" }
    const sealed = await sealSessionData(envelope)
    return sealed && sealed.length <= limits.maxSealedCharacters
      ? { ok: true as const, sealed }
      : { ok: false as const, reason: "seal_failed" }
  })
}

export async function unsealRecoveredSurveyDraftAction(
  sealed: string,
  token?: string,
) {
  return withSessionRead(token, async () => {
    const session = await getSession()
    if (sealed.length > limits.maxSealedCharacters)
      return { ok: false as const, reason: "draft_invalid" }
    const envelope = await unsealSessionData<{
      purpose?: string
      consentId?: string
      coordinationId?: string
      draft?: unknown
    }>(sealed)
    const parsed = recoveredSurveyDraftSchema.safeParse(envelope?.draft)
    if (
      envelope?.purpose !== "recovered-survey" ||
      !session.authVerifiedAt ||
      !session.consentId ||
      envelope.consentId !== session.consentId ||
      envelope.coordinationId !== session.coordinationId ||
      parsed.success !== true ||
      parsed.data.analysisId !== session.recoveredSurveyAnalysisId ||
      parsed.data.analysisId !== session.lastCompletedAnalysisId
    )
      return { ok: false as const, reason: "draft_invalid" }
    return { ok: true as const, draft: parsed.data }
  })
}

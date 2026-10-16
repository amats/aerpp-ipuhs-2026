"use server"

import { env } from "@aerpp/config/server/web"
import { z } from "zod"
import {
  type AnalysisResult,
  type AnalysisResultReadOutcome,
  analysisResultSchema,
  type SurveyResultSealOutcome,
} from "@/features/app-context/analysis-result-types"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import {
  isLocallyAuthenticated,
  readLocalAuthenticationFromSession,
} from "@/features/auth/auth-session"
import {
  matchesSurveyDefinition,
  validateSurveySubmissionInput,
} from "@/features/survey/survey-answer-validation"
import { BROWSER_PAYLOAD_CONSTRAINTS as limits } from "@/lib/browser-payload-constraints.mjs"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { safeParseApiRequest } from "@/lib/participant-api-contract-helpers"
import { getSessionForTab } from "@/lib/session"
import { readAuthority } from "@/lib/session-authority"
import { sealSessionData, unsealSessionData } from "@/lib/session-seal"
import { readSubmittedAnalysisIdFromSession } from "./analysis-session"

const sealedResultSchema = z.string().min(1).max(limits.maxSealedCharacters)
const resultEnvelopeSchema = z.object({
  ownerClientId: z.string().min(1),
  ownerPseudonym: z.string().min(1),
  result: analysisResultSchema,
})
const logger = createLogger({ component: "llm", operation: "result_storage" })

async function readAuthenticatedOwner(token?: string) {
  const session = await getSessionForTab(token)
  const authentication = await readLocalAuthenticationFromSession(session)
  if (
    isLocallyAuthenticated(authentication) !== true ||
    !authentication.clientId ||
    !authentication.pseudonym
  ) {
    return null
  }
  return {
    consentId: session.consentId,
    coordinationId: session.coordinationId,
    completedAnalysisId: session.lastCompletedAnalysisId,
    stage: readStageFromSession(session),
    submittedAnalysisId: readSubmittedAnalysisIdFromSession(session),
    clientId: authentication.clientId,
    pseudonym: authentication.pseudonym,
  }
}

async function sealResultForOwner(
  result: AnalysisResult,
  owner: NonNullable<Awaited<ReturnType<typeof readAuthenticatedOwner>>>,
  token?: string,
): Promise<string | null> {
  if (owner.coordinationId) {
    const authority = readAuthority(owner.coordinationId)
    if (
      !authority ||
      authority.withdrawing ||
      owner.completedAnalysisId !== result.analysisId
    )
      return null
  }
  // Invalid answers must remain editable; freeze only a sendable request.
  if (result.pendingSurveyAnswer) {
    const submission = validateSurveySubmissionInput({
      stage: owner.stage,
      survey: result.pendingSurveyAnswer,
      definitionId: result.pendingQuestionnaireId,
    })
    if (
      !submission ||
      safeParseApiRequest("submitSurvey", {
        answers: submission.answers,
        questionnaire: submission.questionnaire,
        analysisId: result.analysisId,
        serverId: env.participantApiServerId,
        consentId: owner.consentId,
        clientId: owner.clientId,
        pseudonym: owner.pseudonym,
      }).success !== true
    )
      return null
  }
  const envelope = {
    ownerClientId: owner.clientId,
    ownerPseudonym: owner.pseudonym,
    result,
  }
  if (
    new TextEncoder().encode(JSON.stringify(envelope)).byteLength >
    limits.maxEnvelopeBytes
  )
    return null
  const sealedResult = await sealSessionData(envelope)
  if (owner.coordinationId) {
    const latest = await readAuthenticatedOwner(token)
    const authority = readAuthority(owner.coordinationId)
    if (
      !latest ||
      latest.completedAnalysisId !== result.analysisId ||
      latest.coordinationId !== owner.coordinationId ||
      !authority ||
      authority.withdrawing ||
      owner.completedAnalysisId !== result.analysisId
    )
      return null
  }
  // A saved payload must also be accepted by the subsequent read boundary.
  return sealedResultSchema.safeParse(sealedResult).success === true
    ? sealedResult
    : null
}

export async function sealAnalysisResultAction(
  result: unknown,
  token?: string,
): Promise<string | null> {
  const parsed = analysisResultSchema.safeParse(result)
  if (parsed.success !== true || parsed.data.text.trim() === "") return null
  try {
    const owner = await readAuthenticatedOwner(token)
    if (owner === null) return null
    return await sealResultForOwner(parsed.data, owner, token)
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "result_encrypt_owner",
    })
    return null
  }
}

// Compare the definition and seal the fixed retry payload under the same owner read.
export async function sealSurveyResultAction(
  result: unknown,
  token?: string,
): Promise<SurveyResultSealOutcome> {
  const parsed = analysisResultSchema.safeParse(result)
  if (
    parsed.success !== true ||
    parsed.data.text.trim() === "" ||
    parsed.data.pendingSurveyAnswer === undefined
  )
    return { ok: false, reason: "write_failed" }
  let owner: Awaited<ReturnType<typeof readAuthenticatedOwner>>
  try {
    owner = await readAuthenticatedOwner(token)
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "survey_prepare_owner",
    })
    return { ok: false, reason: "questionnaire_check_failed" }
  }
  if (owner === null) return { ok: false, reason: "questionnaire_check_failed" }
  if (
    matchesSurveyDefinition(owner.stage, parsed.data.pendingQuestionnaireId) !==
    true
  )
    return { ok: false, reason: "questionnaire_changed" }
  try {
    const sealedResult = await sealResultForOwner(parsed.data, owner, token)
    return sealedResult === null
      ? { ok: false, reason: "write_failed" }
      : { ok: true, sealedResult }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "survey_encrypt_owner",
    })
    return { ok: false, reason: "write_failed" }
  }
}

export async function unsealAnalysisResultAction(
  sealedResult: unknown,
  token?: string,
): Promise<AnalysisResultReadOutcome> {
  const parsedSealedResult = sealedResultSchema.safeParse(sealedResult)
  if (parsedSealedResult.success !== true) {
    return { ok: true, result: null }
  }

  try {
    const owner = await readAuthenticatedOwner(token)
    if (!owner) {
      return { ok: true, result: null }
    }
    const unsealedResult = await unsealSessionData<unknown>(
      parsedSealedResult.data,
    )
    const parsedEnvelope = resultEnvelopeSchema.safeParse(unsealedResult)
    if (
      parsedEnvelope.success !== true ||
      parsedEnvelope.data.ownerClientId !== owner.clientId ||
      parsedEnvelope.data.ownerPseudonym !== owner.pseudonym ||
      (owner.coordinationId !== undefined &&
        parsedEnvelope.data.result.analysisId !== owner.completedAnalysisId)
    ) {
      return { ok: true, result: null }
    }
    if (owner.coordinationId) {
      const latest = await readAuthenticatedOwner(token)
      if (
        !latest ||
        latest.coordinationId !== owner.coordinationId ||
        latest.completedAnalysisId !== parsedEnvelope.data.result.analysisId
      )
        return { ok: true, result: null }
    }
    return {
      ok: true,
      result: parsedEnvelope.data.result,
      ...(owner.submittedAnalysisId === parsedEnvelope.data.result.analysisId
        ? { surveySubmitted: true as const }
        : {}),
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "result_decrypt_owner",
    })
    return { ok: false }
  }
}

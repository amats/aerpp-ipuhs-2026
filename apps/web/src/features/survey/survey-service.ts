import "server-only"

import { env } from "@aerpp/config/server/web"
import { headers } from "next/headers"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import type { StepState } from "@/features/app-context/step-state-types"
import {
  createClientId,
  readClientIdFromSession,
  readPseudonymFromSession,
} from "@/features/identity/participant-identifiers"
import {
  type AnalysisCompletionMetadata,
  analysisCompletionMetadataSchema,
} from "@/features/llm/analysis-completion-types"
import { readLastCompletedAnalysisIdFromSession } from "@/features/llm/analysis-session"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import type { AppLogger } from "@/lib/logger"
import { createLogger, getRequestContextFromHeaders } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  type ApiRequest,
  isApiSuccess,
  safeParseApiRequest,
} from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"
import type { AppSession } from "@/lib/session"
import { validateSurveySubmissionInput } from "./survey-answer-validation"

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_REQUEST_RETRIES = 0

function createRecordAnalysisCompletionRequestBody({
  metadata,
  clientId,
  pseudonym,
  consentId,
}: {
  consentId: string
  metadata: AnalysisCompletionMetadata
  clientId: string
  pseudonym: string
}): ApiRequest<"recordAnalysisCompletion"> {
  return {
    consentId,
    analysisId: metadata.analysisId,
    analysisWorkspaceVersion: metadata.analysisWorkspaceVersion,
    clientId,
    pseudonym,
    serverId: env.participantApiServerId,
    modelName: metadata.modelName,
    processingDurationSeconds: metadata.processingDurationSeconds,
    documentCount: metadata.documentCount,
    documentGraphemeCount: metadata.documentGraphemeCount,
    resultGraphemeCount: metadata.resultGraphemeCount,
  }
}

async function createSurveyLogger(operation: string) {
  const headerStore = await headers()
  return createLogger({
    ...getRequestContextFromHeaders(headerStore),
    component: "survey",
    operation,
  })
}

function ensureSurveySubmissionStepState({
  stepState,
  logger,
  logEvent,
  details = {},
}: {
  stepState: StepState
  logger: AppLogger
  logEvent: string
  details?: Record<string, unknown>
}) {
  if (
    matchesStepState(stepState, [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
      { stage: Stage.authenticated, step: RootStep.survey },
      { stage: Stage.followUp, step: RootStep.survey },
    ]) === true
  ) {
    return true
  }

  logger.warn({
    ...details,
    event: logEvent,
    operation: "step_state",
    outcome: "rejected",
    rootStep: stepState.step,
    stage: stepState.stage,
  })
  return false
}

function matchesStepState(current: StepState | null, allowed: StepState[]) {
  return allowed.some(
    (stepState) =>
      current?.stage === stepState.stage && current.step === stepState.step,
  )
}

async function ensureAnalysisCompletionMetadataStepState({
  session,
  logger,
  logEvent,
  details = {},
}: {
  session: AppSession
  logger: AppLogger
  logEvent: string
  details?: Record<string, unknown>
}) {
  const stepState = await readStepStateFromSession(session)
  if (
    matchesStepState(stepState, [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
    ]) === true
  ) {
    return true
  }

  logger.warn({
    ...details,
    event: logEvent,
    operation: "step_state",
    outcome: "rejected",
    rootStep: stepState.step,
    stage: stepState.stage,
  })
  return false
}

async function fetchSurveyApi({
  url,
  body,
  dependency,
  logger,
}: {
  url: string
  body: object
  dependency: string
  logger: AppLogger
}) {
  return fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...participantApiHeaders(),
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      logging: {
        dependency,
        logger,
        target: "participant_api",
      },
      retries: DEFAULT_REQUEST_RETRIES,
    },
  )
}

async function getOrCreateSurveyIdentifiers(session: AppSession) {
  let clientId = await readClientIdFromSession(session)
  if (!clientId) {
    clientId = createClientId()
    if (clientId) {
      session.clientId = clientId
    }
  }
  const pseudonym = await readPseudonymFromSession(session)

  if (!clientId || !pseudonym) {
    return null
  }

  return {
    clientId,
    pseudonym,
  }
}

export async function recordAnalysisCompletion(
  session: AppSession,
  metadata: unknown,
): Promise<boolean> {
  const logger = await createSurveyLogger("submit_metadata")
  try {
    const parsedMetadata = analysisCompletionMetadataSchema.safeParse(metadata)
    if (parsedMetadata.success !== true) {
      logger.warn({
        event: LOG_EVENT.analysisCompletionRecordFailed,
        operation: "validation",
        outcome: "rejected",
      })
      return false
    }
    const validatedMetadata = parsedMetadata.data

    const isAllowedStepState = await ensureAnalysisCompletionMetadataStepState({
      session,
      logger,
      logEvent: LOG_EVENT.analysisCompletionRecordFailed,
      details: {
        analysisId: validatedMetadata.analysisId,
      },
    })
    if (isAllowedStepState !== true) {
      return false
    }

    const identifiers = await getOrCreateSurveyIdentifiers(session)
    if (!identifiers) {
      logger.error({
        analysisId: validatedMetadata.analysisId,
        event: LOG_EVENT.analysisCompletionRecordFailed,
        operation: "identifiers",
      })
      return false
    }

    if (!session.consentId) return false
    const requestBody = createRecordAnalysisCompletionRequestBody({
      consentId: session.consentId,
      metadata: validatedMetadata,
      clientId: identifiers.clientId,
      pseudonym: identifiers.pseudonym,
    })

    const parsedRequest = safeParseApiRequest(
      "recordAnalysisCompletion",
      requestBody,
    )
    if (parsedRequest.success !== true) return false

    const response = await fetchSurveyApi({
      url: env.recordAnalysisCompletionUrl,
      body: parsedRequest.data,
      dependency: "record_analysis_completion",
      logger,
    })
    if ((await isApiSuccess("recordAnalysisCompletion", response)) !== true) {
      logger.warn({
        analysisId: validatedMetadata.analysisId,
        event: LOG_EVENT.analysisCompletionRecordFailed,
        outcome:
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
            ? "rejected"
            : "unconfirmed",
        statusCode: response.status,
      })
      return false
    }

    return true
  } catch (error) {
    logger[
      error instanceof DOMException && error.name === "TimeoutError"
        ? "warn"
        : "error"
    ]({
      event: LOG_EVENT.analysisCompletionRecordFailed,
      error,
      outcome: "unconfirmed",
    })
    return false
  }
}

export type SubmitSurveyResult =
  | { ok: true }
  | { ok: false; reason: "submit_failed" }

export async function submitSurvey(
  session: AppSession,
  survey: unknown,
  definitionId: unknown,
): Promise<SubmitSurveyResult> {
  const logger = await createSurveyLogger("submit")
  try {
    const stepState = await readStepStateFromSession(session)
    const validatedSubmission = validateSurveySubmissionInput({
      stage: stepState.stage,
      survey,
      definitionId,
    })
    if (!validatedSubmission) {
      logger.warn({
        event: LOG_EVENT.surveySubmitFailed,
        operation: "validation",
        outcome: "rejected",
      })
      return { ok: false, reason: "submit_failed" }
    }

    const analysisId = readLastCompletedAnalysisIdFromSession(session)
    if (!analysisId) {
      logger.warn({
        event: LOG_EVENT.surveySubmitFailed,
        operation: "analysis_id",
        outcome: "rejected",
      })
      return { ok: false, reason: "submit_failed" }
    }

    const isAllowedStepState = ensureSurveySubmissionStepState({
      stepState,
      logger,
      logEvent: LOG_EVENT.surveySubmitFailed,
      details: { analysisId },
    })
    if (isAllowedStepState !== true) {
      return { ok: false, reason: "submit_failed" }
    }

    const clientId = await readClientIdFromSession(session)
    const pseudonym = await readPseudonymFromSession(session)
    if (!clientId || !pseudonym) return { ok: false, reason: "submit_failed" }

    if (!session.consentId) return { ok: false, reason: "submit_failed" }
    const requestBody: ApiRequest<"submitSurvey"> = {
      consentId: session.consentId,
      serverId: env.participantApiServerId,
      clientId,
      pseudonym,
      answers: validatedSubmission.answers,
      questionnaire: validatedSubmission.questionnaire,
      analysisId,
    }

    const parsedRequest = safeParseApiRequest("submitSurvey", requestBody)
    if (parsedRequest.success !== true)
      return { ok: false, reason: "submit_failed" }

    const response = await fetchSurveyApi({
      url: env.submitSurveyUrl,
      body: parsedRequest.data,
      dependency: "submit_survey",
      logger,
    })
    if ((await isApiSuccess("submitSurvey", response)) !== true) {
      logger.warn({
        analysisId,
        event: LOG_EVENT.surveySubmitFailed,
        outcome:
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
            ? "rejected"
            : "unconfirmed",
        statusCode: response.status,
      })
      return { ok: false, reason: "submit_failed" }
    }

    return { ok: true }
  } catch (error) {
    logger[
      error instanceof DOMException && error.name === "TimeoutError"
        ? "warn"
        : "error"
    ]({
      event: LOG_EVENT.surveySubmitFailed,
      error,
      outcome: "unconfirmed",
    })
    return { ok: false, reason: "submit_failed" }
  }
}

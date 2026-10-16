import type { NextRequest } from "next/server"
import { z } from "zod"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import type { StepState } from "@/features/app-context/step-state-types"
import {
  isLocallyAuthenticated,
  readLocalAuthenticationFromSession,
} from "@/features/auth/auth-session"
import {
  type AnalysisDocument,
  analysisDocumentSchema,
} from "@/features/document/analysis-document-types"
import { DOCUMENT_CONSTRAINTS } from "@/features/document/document-constraints"
import { handleAnalysisJobRead } from "@/features/llm/analysis-job-route"
import { acceptAnalysisJob } from "@/features/llm/analysis-job-service"
import { buildAnalysisUserPrompt } from "@/features/llm/request-lm-studio-response"
import { withSessionOperation } from "@/features/session/session-operation"
import { countGraphemes } from "@/lib/graphemes"
import {
  type AppLogger,
  createRequestLogger,
  logRouteRejected,
} from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { REQUEST_ID_HEADER } from "@/lib/request-id"
import { type AppSession, getSession, getSessionToken } from "@/lib/session"
import { sessionOperation } from "@/lib/session-authority"

const streamRequestBodySchema = z
  .object({
    documents: z
      .array(analysisDocumentSchema)
      .max(DOCUMENT_CONSTRAINTS.maxDocuments),
  })
  .strict()

class RequestBodyTooLargeError extends Error {}

async function readRequestJson(request: Request): Promise<unknown> {
  if (!request.body) {
    throw new Error("missing request body")
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bodyText = ""
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        bodyText += decoder.decode()
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > DOCUMENT_CONSTRAINTS.maxRequestBytes) {
        await reader.cancel()
        throw new RequestBodyTooLargeError()
      }
      bodyText += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }

  return JSON.parse(bodyText)
}

function matchesStepState(current: StepState | null, allowed: StepState[]) {
  return allowed.some(
    (stepState) =>
      current?.stage === stepState.stage && current.step === stepState.step,
  )
}

function isAllowedAnalysisStepState(stepState: StepState | null) {
  return matchesStepState(stepState, [
    { stage: Stage.authenticated, step: RootStep.result },
    { stage: Stage.followUp, step: RootStep.result },
  ])
}

function createBadRequestResponse(message: string, requestId: string) {
  return new Response(message, {
    headers: {
      [REQUEST_ID_HEADER]: requestId,
    },
    status: 400,
  })
}

function parseDocuments({
  body,
  requestId,
  requestLogger,
}: {
  body: unknown
  requestId: string
  requestLogger: AppLogger
}):
  | {
      documentCount: number
      textDocuments: AnalysisDocument[]
      totalCodeUnits: number
      totalGraphemeCount: number
    }
  | Response {
  const parsedBody = streamRequestBodySchema.safeParse(body)
  if (!parsedBody.success) {
    requestLogger.warn({
      event: LOG_EVENT.routeRequestRejected,
      operation: "parse_documents",
      outcome: "rejected",
      statusCode: 400,
    })
    return createBadRequestResponse("不正なリクエストです", requestId)
  }

  const textDocuments = parsedBody.data.documents
  let documentCount = 0
  let totalCodeUnits = 0
  let totalGraphemeCount = 0

  for (const doc of textDocuments) {
    totalCodeUnits += doc.name.length + doc.text.length
    totalGraphemeCount += countGraphemes(doc.name) + countGraphemes(doc.text)
    if (doc.text.trim() !== "") {
      documentCount += 1
    }
  }

  if (documentCount === 0) {
    requestLogger.warn({
      event: LOG_EVENT.routeRequestRejected,
      operation: "empty_documents",
      outcome: "rejected",
      statusCode: 400,
    })
    return createBadRequestResponse("解析対象の書類が空です", requestId)
  }

  if (totalGraphemeCount > DOCUMENT_CONSTRAINTS.maxTotalGraphemes) {
    requestLogger.warn({
      event: LOG_EVENT.routeRequestRejected,
      maxTotalGraphemes: DOCUMENT_CONSTRAINTS.maxTotalGraphemes,
      outcome: "rejected",
      statusCode: 400,
      totalGraphemeCount,
    })
    return createBadRequestResponse("書類の内容が長すぎます", requestId)
  }

  return {
    documentCount,
    textDocuments,
    totalCodeUnits,
    totalGraphemeCount,
  }
}

// Accepts an authenticated analysis; inference outlives this HTTP connection.
async function startAnalysisJob(request: NextRequest) {
  const startedAtMs = Date.now()
  const { logger: requestLogger, requestId } = createRequestLogger(request, {
    component: "llm",
    operation: "analysis_start",
  })

  let stepState: StepState | null = null
  let hasLocalAuthentication = false
  let ownerClientId: string | null = null
  let ownerPseudonym: string | null = null
  let session: AppSession | null = null
  try {
    session = await getSession()
    stepState = await readStepStateFromSession(session)
    const isAllowedStepState = isAllowedAnalysisStepState(stepState)
    const localAuthentication = isAllowedStepState
      ? await readLocalAuthenticationFromSession(session)
      : null
    hasLocalAuthentication =
      localAuthentication !== null &&
      isLocallyAuthenticated(localAuthentication)
    ownerClientId = localAuthentication?.clientId ?? null
    ownerPseudonym = localAuthentication?.pseudonym ?? null
  } catch (error) {
    requestLogger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "analysis_session_read",
    })
  }
  if (
    isAllowedAnalysisStepState(stepState) !== true ||
    hasLocalAuthentication !== true ||
    !ownerClientId ||
    !ownerPseudonym ||
    !session?.coordinationId ||
    !session.consentId
  ) {
    logRouteRejected(requestLogger, 401, {
      stage: stepState?.stage ?? Stage.unauthenticated,
      rootStep: stepState?.step,
    })
    return new Response("認証が必要です", {
      headers: {
        [REQUEST_ID_HEADER]: requestId,
      },
      status: 401,
    })
  }

  let body: unknown
  try {
    const declaredContentLength = Number(
      request.headers.get("content-length") ?? "0",
    )
    if (
      Number.isFinite(declaredContentLength) &&
      declaredContentLength > DOCUMENT_CONSTRAINTS.maxRequestBytes
    ) {
      return createBadRequestResponse("書類の内容が長すぎます", requestId)
    }
    body = await readRequestJson(request)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      logRouteRejected(requestLogger, 400, {
        operation: "request_body_too_large",
      })
      return createBadRequestResponse("書類の内容が長すぎます", requestId)
    }
    logRouteRejected(
      requestLogger,
      400,
      {
        operation: "invalid_json",
      },
      error,
    )
    return createBadRequestResponse("不正なリクエストです", requestId)
  }

  const parsedDocuments = parseDocuments({ body, requestId, requestLogger })
  if (parsedDocuments instanceof Response) {
    return parsedDocuments
  }
  const { documentCount, textDocuments, totalCodeUnits, totalGraphemeCount } =
    parsedDocuments
  if (totalCodeUnits > DOCUMENT_CONSTRAINTS.maxTotalCodeUnits) {
    requestLogger.warn({
      event: LOG_EVENT.routeRequestRejected,
      operation: "document_code_units",
      outcome: "rejected",
      statusCode: 400,
      totalCodeUnits,
    })
    return createBadRequestResponse("書類の内容が長すぎます", requestId)
  }

  const accepted = await acceptAnalysisJob({
    session,
    startedAtMs,
    logger: requestLogger,
    input: {
      prompt: buildAnalysisUserPrompt(textDocuments),
      documentCount,
      documentGraphemeCount: totalGraphemeCount,
      documentGraphemeCounts: textDocuments
        .filter((doc) => doc.text.trim() !== "")
        .map((doc) => countGraphemes(doc.text)),
    },
  })
  return Response.json(accepted, {
    status:
      accepted.ok === true
        ? 202
        : accepted.reason === "analysis_mismatch"
          ? 409
          : 503,
    headers: {
      "Cache-Control": "no-store",
      "x-aerpp-session-token": getSessionToken(session.coordinationId),
      [REQUEST_ID_HEADER]: requestId,
    },
  })
}

export async function POST(request: NextRequest) {
  const result = await withSessionOperation(
    request.headers.get("x-aerpp-tab"),
    "ordinary",
    async () => {
      const response = await startAnalysisJob(request)
      const id = sessionOperation.getStore()?.id
      if (id) response.headers.set("x-aerpp-session-token", getSessionToken(id))
      return response
    },
  )
  if (result instanceof Response) return result
  const { logger, requestId } = createRequestLogger(request, {
    component: "llm",
    operation: "analysis_start",
  })
  logRouteRejected(logger, 409, { operation: "analysis_admission" })
  return Response.json(result, {
    status: 409,
    headers: { "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId },
  })
}

export async function GET(request: Request) {
  return handleAnalysisJobRead(request)
}

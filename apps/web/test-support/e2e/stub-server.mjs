import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
import { ApiContracts } from "@aerpp/participant-api-contracts/participant-api"
import llmPreset from "../../../../config/common/llm/lms-medgemma.json" with {
  type: "json",
}
import {
  DOCUMENT_TEXT,
  RESULT_TEXT,
  STUB_PORT,
  TEST_SUPPORT_CREDENTIAL,
} from "./constants.mjs"

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(value))
}

export async function startStubServer({ restartApplication } = {}) {
  let state
  let scenario
  const consentRequests = new Map()
  const studyKinds = new Map()
  const appliedRecoveries = new Map()
  const confirmedRecoveryConsents = new Set()
  const withdrawnConsentIds = new Set()
  const completedAnalysisParticipants = new Set()
  const analysisAttempts = new Map()
  const withdrawalAnalysisHistory = new Map()
  const heldResponses = new Set()
  function holdResponse(response, complete) {
    heldResponses.add(complete)
    response.once("close", () => heldResponses.delete(complete))
  }
  function reset() {
    for (const release of heldResponses) release()
    heldResponses.clear()
    consentRequests.clear()
    studyKinds.clear()
    appliedRecoveries.clear()
    confirmedRecoveryConsents.clear()
    withdrawnConsentIds.clear()
    completedAnalysisParticipants.clear()
    analysisAttempts.clear()
    withdrawalAnalysisHistory.clear()
    scenario = {}
    state = {
      calls: {},
      violations: [],
      surveyHashes: [],
      consentHashes: [],
      consentIds: [],
      analysisAttempts: [],
      analysisAuditOutcomes: [],
      withdrawalHashes: [],
      sawDocument: false,
      analysisPromptHashes: [],
      abortedAnalyses: 0,
    }
  }
  reset()

  function hasCompletedAnalysis(pseudonym) {
    if (completedAnalysisParticipants.has(pseudonym)) return true
    return [...analysisAttempts.values()].some(
      (attempt) =>
        attempt.pseudonym === pseudonym &&
        !["failed", "cancelled"].includes(attempt.outcome),
    )
      ? null
      : false
  }

  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const bodyText = Buffer.concat(chunks).toString()
      const body = bodyText ? JSON.parse(bodyText) : {}
      const requestedPath = new URL(request.url, "http://127.0.0.1").pathname
      const supportOperation = Object.entries(SUPPORT_ROUTES).find(
        ([, path]) => path === requestedPath,
      )?.[0]
      const pathname = requestedPath
      if (pathname === "/__test/reset" && request.method === "POST") {
        reset()
        return sendJson(response, { ok: true })
      }
      if (pathname === "/__test/scenario" && request.method === "POST") {
        scenario = body
        // Confirmation is independent of Web's send acknowledgement/next action.
        if (scenario.recoveryConsumed === true && scenario.recovery) {
          const original = [...consentRequests.values()]
            .reverse()
            .find(
              (consent) =>
                consent.expectedRecoveryId === scenario.recovery.recoveryId,
            )
          if (
            original &&
            appliedRecoveries.get(original.pseudonym) !==
              scenario.recovery.recoveryId
          ) {
            confirmedRecoveryConsents.add(original.consentId)
            appliedRecoveries.set(
              original.pseudonym,
              scenario.recovery.recoveryId,
            )
            studyKinds.set(
              original.pseudonym,
              scenario.recovery.destination === "follow-up-document"
                ? "follow-up"
                : "initial",
            )
          }
        }
        return sendJson(response, { ok: true })
      }
      if (pathname === "/__test/release" && request.method === "POST") {
        for (const release of heldResponses) release()
        heldResponses.clear()
        return sendJson(response, { ok: true })
      }
      if (pathname === "/__test/state" && request.method === "GET") {
        return sendJson(response, state)
      }
      if (pathname === "/__test/restart-web" && request.method === "POST") {
        if (!restartApplication)
          return sendJson(response, { error: "Restart is unavailable" }, 409)
        await restartApplication()
        return sendJson(response, { ok: true })
      }
      state.calls[pathname] = (state.calls[pathname] ?? 0) + 1
      if (pathname === "/v1/models" && request.method === "GET") {
        state.calls.models = (state.calls.models ?? 0) + 1
        return sendJson(
          response,
          scenario.failReadiness
            ? { error: "unavailable" }
            : { data: [{ id: llmPreset.model }] },
          scenario.failReadiness ? 503 : 200,
        )
      }
      if (pathname === "/v1/responses" && request.method === "POST") {
        if (body.store !== false || body.stream !== false) {
          state.violations.push("Invalid LLM batch/retention flags")
        }
        state.analysisPromptHashes.push(
          createHash("sha256")
            .update(body.input ?? "")
            .digest("hex"),
        )
        state.sawDocument = body.input?.includes(DOCUMENT_TEXT) === true
        if (scenario.failAnalysis) {
          return sendJson(
            response,
            { error: "Synthetic upstream failure" },
            503,
          )
        }
        response.once("close", () => {
          if (!response.writableEnded) state.abortedAnalyses += 1
        })
        const complete = () =>
          sendJson(response, {
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: scenario.analysisText ?? RESULT_TEXT,
                  },
                ],
              },
            ],
          })
        if (scenario.holdAnalysis) holdResponse(response, complete)
        else complete()
        return
      }

      const entry = Object.entries(ApiContracts).find(
        ([, contract]) => contract.path === pathname,
      )
      const allowed = [
        "sendMagicLink",
        "verifyAuthentication",
        "withdrawParticipation",
        "listParticipationEvents",
        "getParticipationState",
        "recordAnalysisAttempt",
        "recordAnalysisOutcome",
        "recordAnalysisCompletion",
        "submitSurvey",
        "getInformation",
      ]
      if (!entry || !allowed.includes(entry[0])) {
        state.violations.push(
          `Unexpected endpoint: ${request.method} ${pathname}`,
        )
        return sendJson(response, { error: "Unexpected endpoint" }, 404)
      }
      const [name, contract] = entry
      if (
        request.method !== contract.method ||
        !supportOperation ||
        request.headers.authorization !== `Bearer ${TEST_SUPPORT_CREDENTIAL}` ||
        (contract.request && !contract.request.safeParse(body).success)
      ) {
        state.violations.push(`Invalid contract: ${name}`)
        return sendJson(response, { error: "Invalid contract" }, 400)
      }
      const priorConsent = consentRequests.get(body.consentId)
      if (name === "sendMagicLink") {
        if (!priorConsent) consentRequests.set(body.consentId, body)
        state.consentIds.push(body.consentId)
        state.consentHashes.push(
          createHash("sha256").update(bodyText).digest("hex"),
        )
      }
      if (name === "recordAnalysisAttempt") state.analysisAttempts.push(body)
      if (name === "recordAnalysisOutcome")
        state.analysisAuditOutcomes.push(body)
      if (name === "submitSurvey") {
        // Retain a digest only, to prove retries use the original payload.
        state.surveyHashes.push(
          createHash("sha256").update(bodyText).digest("hex"),
        )
      }
      if (name === "withdrawParticipation")
        state.withdrawalHashes.push(
          createHash("sha256").update(bodyText).digest("hex"),
        )
      let failure =
        name === "withdrawParticipation" && scenario.withdrawalFailure
          ? {
              status: scenario.withdrawalFailure === "pending" ? 503 : 500,
              body: {
                error: "Synthetic withdrawal cleanup failure",
                code:
                  scenario.withdrawalFailure === "pending"
                    ? "WITHDRAWAL_CLEANUP_PENDING"
                    : "WITHDRAWAL_CLEANUP_FAILED",
              },
            }
          : name === "submitSurvey" &&
              scenario.failSurveyOnce &&
              state.surveyHashes.length === 1
            ? {
                status: 503,
                body: {
                  error: "Synthetic survey failure",
                  code: "INTERNAL_ERROR",
                },
              }
            : null
      if (
        (name === "recordAnalysisCompletion" && scenario.failMetadata) ||
        (name === "recordAnalysisAttempt" &&
          body.outcome === "completed" &&
          scenario.failTerminal) ||
        (name === "recordAnalysisAttempt" &&
          body.outcome === "failed" &&
          scenario.failFailureRecord) ||
        (name === "recordAnalysisAttempt" &&
          body.outcome === "presented" &&
          scenario.failPresentation) ||
        (name === "recordAnalysisAttempt" &&
          body.outcome === "cancelled" &&
          scenario.failCancellation) ||
        (name === "verifyAuthentication" && scenario.failAuthentication)
      )
        failure = {
          status: 503,
          body: { error: "Synthetic temporary outage", code: "INTERNAL_ERROR" },
        }
      if (name === "sendMagicLink" && scenario.failConsentOnce && !priorConsent)
        failure = {
          status: 503,
          body: { error: "Synthetic response loss", code: "INTERNAL_ERROR" },
        }
      let records = [
        ...(state.calls["/api/participant/send-magic-link"]
          ? [
              {
                documentSet: consentRequests.get(state.consentIds.at(-1))
                  .documentSet,
                id: state.consentIds.at(-1),
                consentId: state.consentIds.at(-1),
                precedingWithdrawalId: scenario.currentWithdrawalId ?? null,
                eventType: "consent",
                consentConfirmedAt: "2026-09-15T00:00:00.000Z",
              },
            ]
          : []),
        ...(state.withdrawalHashes.length
          ? [
              {
                documentSet: consentRequests.get(state.consentIds.at(-1))
                  .documentSet,
                id: "synthetic-withdrawal",
                consentId: state.consentIds.at(-1),
                eventType: "withdrawal",
                withdrawalAcceptedAt: "2026-09-15T01:00:00.000Z",
              },
            ]
          : []),
      ]
      if (name === "listParticipationEvents") {
        if (scenario.failDocumentHistory === true)
          failure = {
            status: 503,
            body: { error: "Synthetic history outage", code: "INTERNAL_ERROR" },
          }
        const consent = records.find((record) => record.eventType === "consent")
        if (consent && scenario.documentHistory === "multiple")
          records.push(
            {
              ...consent,
              id: "older-consent",
              consentId: "older-consent",
              consentConfirmedAt: "2026-08-01T00:00:00.000Z",
            },
            {
              ...consent,
              id: "older-withdrawal",
              consentId: "older-consent",
              eventType: "withdrawal",
              withdrawalAcceptedAt: "2026-08-02T00:00:00.000Z",
              documentSet: { version: "0.9", sha256: "b".repeat(64) },
            },
          )
        if (
          scenario.documentHistory === "different" ||
          scenario.documentHistory === "same-version"
        )
          records = records.map((record) => ({
            ...record,
            documentSet: {
              version:
                scenario.documentHistory === "different"
                  ? "0.9"
                  : record.documentSet.version,
              sha256: "b".repeat(64),
            },
          }))
      }
      if (
        name === "verifyAuthentication" &&
        withdrawnConsentIds.has(body.consentId)
      )
        failure = {
          status: 403,
          body: {
            error: "Participation withdrawn",
            code: "PARTICIPATION_WITHDRAWN",
          },
        }

      const completedConsentRetry =
        confirmedRecoveryConsents.has(body.consentId) &&
        body.expectedWithdrawalId === (scenario.currentWithdrawalId ?? null) &&
        body.expectedRecoveryId === appliedRecoveries.get(body.pseudonym) &&
        !(scenario.recovery && scenario.recoveryConsumed !== true) &&
        JSON.stringify(priorConsent) === JSON.stringify(body)
      if (
        name === "sendMagicLink" &&
        completedConsentRetry !== true &&
        (body.expectedWithdrawalId !== (scenario.currentWithdrawalId ?? null) ||
          body.expectedRecoveryId !==
            (scenario.recovery && !scenario.recoveryConsumed
              ? scenario.recovery.recoveryId
              : null) ||
          body.expectedStudyGeneration !==
            (appliedRecoveries.get(body.pseudonym) ?? null))
      )
        failure = {
          status: 409,
          body: { error: "Consent superseded", code: "CONSENT_SUPERSEDED" },
        }
      // Simulate eligibility advancing elsewhere after this browser authenticated.
      if (
        name === "recordAnalysisAttempt" &&
        body.outcome === "started" &&
        scenario.initialSurveyAcceptedBeforeAnalysis
      )
        studyKinds.set(body.pseudonym, "follow-up")
      const success =
        name === "sendMagicLink"
          ? { ok: true, consentId: body.consentId }
          : name === "getInformation"
            ? { messages: [] }
            : name === "getParticipationState"
              ? {
                  ...(scenario.recovery && !scenario.recoveryConsumed
                    ? { pendingRecovery: scenario.recovery }
                    : {}),
                  studyGeneration:
                    appliedRecoveries.get(body.pseudonym) ?? null,
                  lastWithdrawalId: scenario.currentWithdrawalId ?? null,
                }
              : name === "listParticipationEvents"
                ? {
                    ...(scenario.recovery && !scenario.recoveryConsumed
                      ? { pendingRecovery: scenario.recovery }
                      : {}),
                    studyGeneration:
                      appliedRecoveries.get(body.pseudonym) ?? null,
                    lastWithdrawalId: scenario.currentWithdrawalId ?? null,
                    records: records.map((record) => ({
                      ...record,
                      serverId: "playwright-local",
                      clientId: "synthetic-client",
                      pseudonym: body.pseudonym,
                      encryptedEmail:
                        consentRequests.get(record.consentId)?.encryptedEmail ??
                        consentRequests.get(state.consentIds.at(-1))
                          ?.encryptedEmail,
                    })),
                  }
                : name === "withdrawParticipation"
                  ? {
                      ok: true,
                      deletedCount: 0,
                      hasCompletedAnalysis: withdrawalAnalysisHistory.has(
                        body.consentId,
                      )
                        ? withdrawalAnalysisHistory.get(body.consentId)
                        : hasCompletedAnalysis(body.pseudonym),
                    }
                  : name === "verifyAuthentication" &&
                      scenario.recoveryConsumed &&
                      scenario.recovery &&
                      studyKinds.get(body.pseudonym) === "initial"
                    ? {
                        ok: true,
                        questionnaireKind:
                          studyKinds.get(body.pseudonym) ?? "initial",
                        ...(scenario.recovery.destination === "initial-survey"
                          ? { recovery: scenario.recovery }
                          : {}),
                      }
                    : name === "verifyAuthentication" ||
                        (name === "recordAnalysisAttempt" &&
                          body.outcome === "started")
                      ? {
                          ok: true,
                          questionnaireKind:
                            studyKinds.get(body.pseudonym) ?? "initial",
                        }
                      : { ok: true }
      if (failure) contract.errors.parse(failure.body)
      else contract.success.parse(success)
      const complete = () => {
        if (name === "withdrawParticipation") {
          withdrawnConsentIds.add(body.consentId)
          if (!withdrawalAnalysisHistory.has(body.consentId))
            withdrawalAnalysisHistory.set(
              body.consentId,
              success.hasCompletedAnalysis,
            )
        }
        if (failure) return sendJson(response, failure.body, failure.status)
        if (
          name === "recordAnalysisAttempt" &&
          !["presented", "unavailable"].includes(body.outcome)
        )
          analysisAttempts.set(body.analysisId, {
            ...body,
            ...(body.outcome === "started"
              ? { questionnaireKind: success.questionnaireKind }
              : {
                  questionnaireKind: analysisAttempts.get(body.analysisId)
                    ?.questionnaireKind,
                }),
          })
        if (name === "submitSurvey" && body.questionnaire.kind === "initial")
          studyKinds.set(body.pseudonym, "follow-up")
        if (
          name === "recordAnalysisCompletion" ||
          (name === "recordAnalysisAttempt" && body.outcome === "completed")
        )
          completedAnalysisParticipants.add(body.pseudonym)
        if (name === "withdrawParticipation") {
          completedAnalysisParticipants.delete(body.pseudonym)
          for (const [analysisId, attempt] of analysisAttempts)
            if (attempt.pseudonym === body.pseudonym)
              analysisAttempts.delete(analysisId)
        }
        sendJson(response, success)
      }
      if (
        (name === "verifyAuthentication" && scenario.holdAuthentication) ||
        (name === "withdrawParticipation" && scenario.holdWithdrawal) ||
        (name === "submitSurvey" && scenario.holdSurvey)
      )
        holdResponse(response, complete)
      else {
        const delayMs =
          name === "verifyAuthentication"
            ? scenario.authenticationDelayMs
            : name === "withdrawParticipation"
              ? scenario.withdrawalDelayMs
              : 0
        if (delayMs) {
          const timer = setTimeout(complete, delayMs)
          response.once("close", () => clearTimeout(timer))
        } else complete()
      }
    } catch {
      state.violations.push("Stub request failed")
      if (!response.headersSent)
        sendJson(response, { error: "Stub request failed" }, 500)
      else response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(STUB_PORT, "127.0.0.1", resolve)
  })
  return server
}

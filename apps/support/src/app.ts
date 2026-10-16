import type { Runtime } from "@aerpp/config/support"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
import type { Firestore } from "@google-cloud/firestore"
import express, { type ErrorRequestHandler, type RequestHandler } from "express"
import { OAuth2Client } from "google-auth-library"
import { z } from "zod"
import { authenticateCaller } from "./access.js"
import { throwApiError } from "./api-errors.js"
import { createConfirmationLimiter } from "./confirmation-rate-limit.js"
import { readDocumentOriginal } from "./document-original.js"
import {
  consumeEmailConfirmation,
  issueEmailConfirmation,
} from "./email-authentication.js"
import type { Mailer } from "./mail.js"
import { MAIL_WORK_BUDGET_MS } from "./mail-constraints.js"
import { createMaintenanceHandler } from "./maintenance-handler.js"
import type { OidcVerifier } from "./maintenance-types.js"
import { SUPPORT_STYLES } from "./page-styles.js"
import { CONFIRMATION_SCRIPT, publicPages } from "./pages.js"
import {
  addInformation,
  getInformation,
  getParticipationState,
  listParticipationEvents,
  recordAnalysisAttempt,
  recordAnalysisCompletion,
  recordAnalysisOutcome,
  sendApiErrorResponse,
  submitSurvey,
  verifyAuthentication,
  withdrawParticipation,
} from "./participant-handlers.js"
import { limitCaller } from "./rate-limit.js"
import { withDatabase } from "./storage.js"

export type { OidcVerifier } from "./maintenance-types.js"

const PARTICIPANT_HANDLERS = {
  addInformation,
  listParticipationEvents,
  getInformation,
  getParticipationState,
  recordAnalysisAttempt,
  recordAnalysisOutcome,
  submitSurvey,
  recordAnalysisCompletion,
  verifyAuthentication,
  withdrawParticipation,
}
const OWNER_OPERATIONS = new Set([
  "sendMagicLink",
  "verifyAuthentication",
  "withdrawParticipation",
  "recordAnalysisAttempt",
  "recordAnalysisOutcome",
  "recordAnalysisCompletion",
  "submitSurvey",
])
const oauth = new OAuth2Client()
const verifyOidc: OidcVerifier = async (idToken, audience) =>
  (await oauth.verifyIdToken({ idToken, audience })).getPayload()

export function createSupportApp(
  runtime: Runtime,
  database: Firestore,
  mailer: Mailer,
  verifier: OidcVerifier = verifyOidc,
) {
  const app = express()
  const confirmationLimiter = createConfirmationLimiter()
  app.disable("x-powered-by")
  app.set("case sensitive routing", true)
  app.set("strict routing", true)
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    })
    next()
  })
  app.use((_req, _res, next) => withDatabase(database, () => next()))
  for (const [path, html] of Object.entries(publicPages(runtime.contactEmail)))
    app.get(path, (_req, res) => {
      res.type("html").send(html)
    })
  app.get("/assets/support.css", (_req, res) => {
    res.type("text/css").send(SUPPORT_STYLES)
  })
  app.get("/assets/confirmation.js", (_req, res) => {
    res.type("application/javascript").send(CONFIRMATION_SCRIPT)
  })
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n")
  })
  app.get("/health", (_req, res) => {
    res.json({ ok: true })
  })
  app.post(
    "/email/confirm",
    (_req, res, next) => {
      res.locals.operation = "confirmEmail"
      next()
    },
    (req, _res, next) => {
      if (!runtime.admissionOpen)
        throwApiError(503, "ADMISSION_CLOSED", "admission closed")
      if (
        req.get("origin") !== new URL(runtime.baseUrl).origin ||
        !req.is("application/json")
      )
        throwApiError(
          403,
          "CONFIRMATION_FORBIDDEN",
          "confirmation not permitted",
        )
      next()
    },
    express.json({ limit: 1024 }),
    async (req, res) => {
      const permit = confirmationLimiter.acquire()
      if (permit.ok !== true) {
        res.set("Retry-After", String(permit.retryAfterSeconds))
        res.status(429).json({
          code: "RATE_LIMITED",
          error: "request limit reached; retry later",
        })
        return
      }
      try {
        res.json(await consumeEmailConfirmation(req.body, runtime))
      } finally {
        // Keep the slot through Firestore retries and even client disconnects.
        // Only the settled operation may release it.
        permit.release()
      }
    },
  )

  for (const [operation, path] of Object.entries(SUPPORT_ROUTES)) {
    if (operation === "magicCompletePage") continue
    const authenticate: RequestHandler = async (req, res, next) => {
      res.locals.workDeadline = Date.now() + MAIL_WORK_BUDGET_MS
      res.locals.operation = operation
      res.locals.caller = authenticateCaller(
        req.get("authorization"),
        runtime.credentials,
        runtime.environment,
        operation,
      )
      await limitCaller(res.locals.caller.id)
      next()
    }
    const execute: RequestHandler = async (req, res) => {
      if (
        OWNER_OPERATIONS.has(operation) &&
        req.body?.serverId !== res.locals.caller.serverId
      )
        throwApiError(
          403,
          "SERVER_ID_FORBIDDEN",
          "server identity does not match caller",
        )
      if (operation === "readDocumentOriginal") {
        res.json(await readDocumentOriginal(req.body, runtime))
        return
      }
      if (operation === "sendMagicLink") {
        if (!runtime.admissionOpen)
          throwApiError(503, "ADMISSION_CLOSED", "admission closed")
        res.json(
          await issueEmailConfirmation(
            req.body,
            res.locals.caller.id,
            runtime,
            mailer,
            res.locals.workDeadline,
          ),
        )
        return
      }
      if (operation === "listParticipationEvents") {
        const result = z
          .object({ pseudonym: z.string().min(1).max(256) })
          .strict()
          .safeParse(req.body)
        if (!result.success)
          throwApiError(400, "INVALID_REQUEST", "invalid request")
      }
      const handler = PARTICIPANT_HANDLERS[
        operation as keyof typeof PARTICIPANT_HANDLERS
      ] as RequestHandler
      await handler(req, res, () => {})
    }
    if (operation === "getInformation") app.get(path, authenticate, execute)
    else
      app.post(path, authenticate, express.json({ limit: 1_020_000 }), execute)
  }
  for (const [path, operation] of [
    ["/maintenance/withdrawal-cleanup", "withdrawalCleanup"],
    ["/maintenance/mail-health", "mailHealth"],
  ]) {
    app.post(
      path,
      createMaintenanceHandler(path, operation, runtime, mailer, verifier),
    )
  }
  app.use((_req, res) => {
    res.status(404).json({ code: "NOT_FOUND", error: "not found" })
  })
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (
      error?.type === "entity.too.large" ||
      error?.type === "entity.parse.failed"
    ) {
      res
        .status(error.type === "entity.too.large" ? 413 : 400)
        .json({ code: "INVALID_REQUEST", error: "invalid request" })
      return
    }
    sendApiErrorResponse(res, error, res.locals.operation)
  }
  app.use(errors)
  return app
}

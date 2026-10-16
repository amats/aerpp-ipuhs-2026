import { resolveParticipantApiUrl } from "./index.mjs"

// Shared fixed routes for the Support API.
export const SUPPORT_ROUTES = Object.freeze({
  readDocumentOriginal: "/api/participant/document-original",
  sendMagicLink: "/api/participant/send-magic-link",
  verifyAuthentication: "/api/participant/verify-authentication",
  withdrawParticipation: "/api/participant/withdraw-participation",
  listParticipationEvents: "/api/participant/participation-events",
  getParticipationState: "/api/participant/participation-state",
  recordAnalysisAttempt: "/api/participant/analysis-attempt",
  recordAnalysisOutcome: "/api/participant/analysis-outcome",
  recordAnalysisCompletion: "/api/participant/analysis-completion",
  submitSurvey: "/api/participant/survey",
  getInformation: "/api/participant/information",
  addInformation: "/api/operator/information",
  magicCompletePage: "/email/confirm",
})

export function buildSupportUrls(baseUrl) {
  const url = new URL(resolveParticipantApiUrl(baseUrl))
  if (url.pathname !== "/")
    throw new Error("Support base URL must be an origin without a path")
  return Object.freeze(
    Object.fromEntries(
      Object.entries(SUPPORT_ROUTES).map(([operation, path]) => [
        operation,
        new URL(path, url).href,
      ]),
    ),
  )
}

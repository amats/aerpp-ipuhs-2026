export const SUPPORT_ROUTES: Readonly<{
  readDocumentOriginal: "/api/participant/document-original"
  sendMagicLink: "/api/participant/send-magic-link"
  verifyAuthentication: "/api/participant/verify-authentication"
  withdrawParticipation: "/api/participant/withdraw-participation"
  listParticipationEvents: "/api/participant/participation-events"
  getParticipationState: "/api/participant/participation-state"
  recordAnalysisAttempt: "/api/participant/analysis-attempt"
  recordAnalysisOutcome: "/api/participant/analysis-outcome"
  recordAnalysisCompletion: "/api/participant/analysis-completion"
  submitSurvey: "/api/participant/survey"
  getInformation: "/api/participant/information"
  addInformation: "/api/operator/information"
  magicCompletePage: "/email/confirm"
}>
export function buildSupportUrls(
  baseUrl: string,
): Readonly<Record<keyof typeof SUPPORT_ROUTES, string>>

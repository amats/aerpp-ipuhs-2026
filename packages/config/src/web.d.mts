import type { Environment } from "./index.mjs"
export function validateWebRuntimeEnvironment(source: Environment): string[]
export function readWebEnvironment(source: Environment): {
  nodeEnv: string | undefined
  debugPagesEnabled: boolean
  participantApiServerId: string
  identifierHashSecret: string
  sessionSealPassword: string
  authenticationEmailSender: string | undefined
  supportApiCredential: string
  readDocumentOriginalUrl: string
  sendMagicLinkUrl: string
  verifyAuthenticationUrl: string
  withdrawParticipationUrl: string
  listParticipationEventsUrl: string
  getParticipationStateUrl: string
  recordAnalysisAttemptUrl: string
  recordAnalysisOutcomeUrl: string
  recordAnalysisCompletionUrl: string
  submitSurveyUrl: string
  getInformationUrl: string
  sessionCookieSecure: boolean
  receptionExpiresAt: Date
  supportContactEmail: string
  logLevel: string
}

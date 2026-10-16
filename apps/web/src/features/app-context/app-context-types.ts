import type { StepTransitionResult } from "@/features/app-context/actions-step-state"
import type { AnalysisResult } from "@/features/app-context/analysis-result-types"
import type { RootStep } from "@/features/app-context/root-step-types"
import type { Stage } from "@/features/app-context/stage-types"
import type { StepState } from "@/features/app-context/step-state-types"
import type { PrepareConsentResult } from "@/features/auth/consent-context-types"
import type {
  DocumentDraft,
  UpdateDocumentDraft,
} from "@/features/document/document-draft-types"
import type { ConsentDraft } from "@/features/home-flow/consent-draft-types"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"

export type AnalysisJob = {
  // Browser job identity for stale-work checks; separate from HTTP and analysis IDs.
  jobId: string
  documents: Record<string, string>
  documentNames?: Record<string, string>
}

export type AppContextState = {
  withdrawalCleanupStatus:
    | "unconfirmed"
    | "stateFailed"
    | "pending"
    | "complete"
    | "localFailed"
  analysisStatus?: string
  sessionAdmission?: "checking" | "unavailable" | "ready"
  canRetrySessionAdmission?: boolean
  stepState: StepState
  stage: Stage
  rootStep: RootStep
  analysisJob: AnalysisJob | null
  result: AnalysisResult | null
  recoveredSurveyAnalysisId?: string
  recoveredSurveyPending?: boolean
  isRestoringResult: boolean
  resultRestorationFailed: boolean
  surveyDefinitionId?: string
  surveyAnswer: SurveyAnswer
  consentDraft: ConsentDraft
  documentDraft: DocumentDraft
}

export type StepStateTransitionResult =
  | { ok: true }
  | Exclude<StepTransitionResult, { ok: true }>
type StepStateTransitionFailureResult = Exclude<
  StepStateTransitionResult,
  { ok: true }
>

export type CompleteWithdrawalResult =
  | {
      ok: true
      cleanupPending?: boolean
      stateWriteFailed?: boolean
      resultCleared?: boolean
    }
  | StepStateTransitionFailureResult

export type CompleteConsentResult =
  | { ok: true }
  | StepStateTransitionFailureResult

export type ConfirmAuthenticationResult =
  | { ok: true }
  | StepStateTransitionFailureResult
  | { ok: false; reason: "result_clear_failed" }

export type PrepareNewAnalysisResult =
  | {
      ok: true
      resultCleared: boolean
    }
  | StepStateTransitionFailureResult

export type StartAnalysisResult =
  | { ok: true }
  | StepStateTransitionFailureResult

export type CompleteAnalysisResult =
  | { ok: true; resultStored: boolean }
  | { ok: false; reason: "stale_analysis" | "storage_changed" | "session_busy" }

export type StartSurveyResult =
  | { ok: true }
  | StepStateTransitionFailureResult
  | { ok: false; reason: "no_result" }

export type CompleteSurveySubmissionResult =
  | { ok: true; localCleanupFailed?: true }
  | StepStateTransitionFailureResult

export type AppContextActions = {
  retrySessionAdmission: () => void
  clearClientState: () => void
  completeWithdrawal: (email?: string) => Promise<CompleteWithdrawalResult>
  readWithdrawalCleanup: () => Promise<CompleteWithdrawalResult>
  resetToStart: () => Promise<StepStateTransitionResult>
  updateSurveyAnswer: (
    name: string,
    value: string,
    definitionId?: string,
  ) => void
  updateConsentDraft: (draft: Partial<ConsentDraft>) => void
  updateDocumentDraft: UpdateDocumentDraft
  moveToExplanation: () => Promise<StepStateTransitionResult>
  moveToOverview: () => Promise<StepStateTransitionResult>
  moveToConsent: () => Promise<StepStateTransitionResult>
  prepareConsent: (email: string) => Promise<PrepareConsentResult>
  completeConsent: (
    email: string,
    consentContext?: string,
  ) => Promise<CompleteConsentResult>
  confirmAuthentication: () => Promise<ConfirmAuthenticationResult>
  correctConsentEmail: () => Promise<StepStateTransitionResult>
  prepareNewAnalysis: () => Promise<PrepareNewAnalysisResult>
  startAnalysis: (job: AnalysisJob) => Promise<StartAnalysisResult>
  observeAnalysisParticipation: (kind: "initial" | "follow-up") => void
  failAnalysis: () => Promise<StepStateTransitionResult>
  recoverUnavailableAnalysis: (
    analysisId: string,
  ) => Promise<StepStateTransitionResult>
  cancelAnalysis: () => Promise<StepStateTransitionResult>
  completeAnalysis: (
    result: AnalysisResult,
    signal?: AbortSignal,
  ) => Promise<CompleteAnalysisResult>
  startSurvey: () => Promise<StartSurveyResult>
  returnToResult: () => Promise<StepStateTransitionResult>
  completeSurveySubmission: (
    surveyAnswer: SurveyAnswer,
    definitionId: string,
  ) => Promise<CompleteSurveySubmissionResult>
}

export type AppContextValue = {
  state: AppContextState
  actions: AppContextActions
}

export type AppContextPublicValue = AppContextState & AppContextActions

"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  cancelAnalysisAction,
  completeSurveySubmissionAction,
  completeWithdrawalAction,
  confirmAuthenticationAndPrepareAnalysisAction,
  correctConsentEmailAction,
  failAnalysisAction,
  moveToConsentAction,
  moveToExplanationAction,
  moveToOverviewAction,
  prepareConsentContextAction,
  prepareNewAnalysisAction,
  prepareWithdrawalAction,
  readWithdrawalCleanupAction,
  recoverUnavailableAnalysisAction,
  resetFlowAction,
  retryWithdrawalCleanupAction,
  returnToResultAction,
  type StepTransitionResult,
  sendConsentEmailAndMoveToAuthAction,
  startAnalysisAction,
  startSurveyAction,
} from "@/features/app-context/actions-step-state"
import type { AnalysisResult } from "@/features/app-context/analysis-result-types"
import { RootStep } from "@/features/app-context/root-step-types"
import { INITIAL_STEP_STATE } from "@/features/app-context/step-state-constants"
import type { StepState } from "@/features/app-context/step-state-types"
import {
  EMPTY_DOCUMENT_DRAFT,
  type UpdateDocumentDraft,
} from "@/features/document/document-draft-types"
import {
  type ConsentDraft,
  EMPTY_CONSENT_DRAFT,
} from "@/features/home-flow/consent-draft-types"
import { recordResultPresentationAction } from "@/features/llm/actions-record-presentation"
import { acknowledgeAnalysisResult } from "@/features/llm/analysis-job-client"
import {
  invalidateAnalysisResultStorageOperations,
  prepareSurveySubmissionInBrowser,
  readAnalysisResultFromBrowser,
  saveAnalysisResultInBrowser,
} from "@/features/llm/analysis-result-storage"
import {
  SESSION_ADMISSION_RETRY_MESSAGE,
  SESSION_RELOAD_NOTICE,
} from "@/features/session/session-recovery"
import { fetchSessionStatus } from "@/features/session/session-status-client"
import { useSessionAdmission } from "@/features/session/use-session-admission"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import {
  clearRecoveredSurveyDraft,
  freezeRecoveredSurveyDraft,
  readRecoveredSurveyDraft,
} from "@/features/survey/survey-recovery-storage"
import { subscribeBrowserState } from "@/lib/browser-database"
import {
  captureBrowserAnalysis,
  clearBrowserAnalysis,
  isBrowserSessionCurrent,
} from "@/lib/browser-session"
import type { BrowserAnalysisSnapshot } from "@/lib/browser-state-types"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import { readTabGeneration } from "@/lib/session-generation"
import {
  guardSessionMutation,
  runSessionMutation,
} from "@/lib/session-mutation"
import {
  adoptSessionToken,
  isTabOperationCurrent,
  waitForTabOperation,
} from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import ActionButton from "@/ui/action-button"
import type {
  AnalysisJob,
  AppContextState,
  AppContextValue,
} from "./app-context-types"
import { Stage } from "./stage-types"

/*
 * Client-side flow orchestrator for root steps, browser storage, analysis jobs,
 * stored results, and consent/document/survey drafts.
 * - Use AppShell's initial StepState only for initial hydration.
 * - After initialization, ignore later initialStepState prop changes.
 * - Request flow changes through intent Server Actions.
 * - Adopt server-returned transitions. A confirmed upstream withdrawal is terminal
 *   even when saving authoritative state fails; expose that failure for retry.
 */

const INITIAL_APP_STATE: AppContextState = {
  withdrawalCleanupStatus: "unconfirmed",
  stepState: INITIAL_STEP_STATE,
  stage: INITIAL_STEP_STATE.stage,
  rootStep: INITIAL_STEP_STATE.step,
  analysisJob: null,
  result: null,
  isRestoringResult: true,
  resultRestorationFailed: false,
  surveyAnswer: {},
  consentDraft: EMPTY_CONSENT_DRAFT,
  documentDraft: EMPTY_DOCUMENT_DRAFT,
  sessionAdmission: "ready",
}

const INTRO_VIEW_PREFIX = "aerpp-intro-view:"
function readIntroView(stepState: StepState): StepState {
  if (stepState.stage !== Stage.unauthenticated) return stepState
  try {
    const scope = readTabGeneration(getTabToken())
    const view = sessionStorage.getItem(`${INTRO_VIEW_PREFIX}${scope}`)
    if (
      view === RootStep.start ||
      view === RootStep.explanation ||
      view === RootStep.consent
    )
      return { ...stepState, step: view }
  } catch {
    /* A tab's optional view preference must not block admission. */
  }
  return stepState
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider({
  initialStepState: initialProviderStepState,
  children,
}: {
  initialStepState: StepState
  children: ReactNode
}) {
  const pathname = usePathname()
  const [stepState, setStepState] = useState(initialProviderStepState)
  const [withdrawalCleanupStatus, setWithdrawalCleanupStatus] =
    useState<AppContextState["withdrawalCleanupStatus"]>("unconfirmed")
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(
    INITIAL_APP_STATE.analysisJob,
  )
  const [result, setResult] = useState<AnalysisResult | null>(
    INITIAL_APP_STATE.result,
  )
  const [isRestoringResult, setIsRestoringResult] = useState(true)
  const [resultRestorationFailed, setResultRestorationFailed] = useState(false)
  const [surveyDefinitionId, setSurveyDefinitionId] = useState<string>()
  const [recoveredSurveyAnalysisId, setRecoveredSurveyAnalysisId] =
    useState<string>()
  const [recoveredSurveyPending, setRecoveredSurveyPending] = useState(false)
  const [surveyAnswer, setSurveyAnswer] = useState<SurveyAnswer>(
    INITIAL_APP_STATE.surveyAnswer,
  )
  const [consentDraft, setConsentDraft] = useState(EMPTY_CONSENT_DRAFT)
  const [documentDraft, setDocumentDraft] = useState(EMPTY_DOCUMENT_DRAFT)
  const documentDraftEnabledRef = useRef(
    initialProviderStepState.step === RootStep.document,
  )
  const updateConsentDraft = useCallback((draft: Partial<ConsentDraft>) => {
    setConsentDraft((current) => ({ ...current, ...draft }))
  }, [])

  const analysisGenerationRef = useRef(0)
  const resetGenerationRef = useRef(0)
  const ordinaryGenerationRef = useRef(0)
  const ordinaryAdmissionRef = useRef(true)
  const pendingCleanupRef = useRef<{
    stepState: StepState
    storage: BrowserAnalysisSnapshot | null
  } | null>(null)
  const awaitCurrentTransition = useCallback(
    async (
      transition: Promise<StepTransitionResult>,
      allowWithoutAdmission = false,
    ): Promise<StepTransitionResult> => {
      const generation = resetGenerationRef.current
      const sessionScope = readTabGeneration(getTabToken())
      const ordinaryGeneration = ordinaryGenerationRef.current
      const result = await (allowWithoutAdmission === true
        ? transition
        : waitForTabOperation(transition))
      const current =
        (!sessionScope || isBrowserSessionCurrent(sessionScope) === true) &&
        generation === resetGenerationRef.current &&
        (allowWithoutAdmission === true ||
          (ordinaryAdmissionRef.current === true &&
            isTabOperationCurrent() === true &&
            ordinaryGeneration === ordinaryGenerationRef.current))
      if (current !== true) return { ok: false, reason: "superseded_operation" }
      if (allowWithoutAdmission === true) await adoptSessionToken(result)
      if (
        (sessionScope && isBrowserSessionCurrent(sessionScope) !== true) ||
        generation !== resetGenerationRef.current
      )
        return { ok: false, reason: "superseded_operation" }
      return result.ok === true
        ? result
        : { ok: false, reason: result.reason ?? "step_state_write_failed" }
    },
    [],
  )
  const invalidateAnalysisWork = useCallback(() => {
    analysisGenerationRef.current += 1
    setIsRestoringResult(false)
    setResultRestorationFailed(false)
    invalidateAnalysisResultStorageOperations()
  }, [])

  useEffect(() => () => invalidateAnalysisWork(), [invalidateAnalysisWork])

  const loadStoredState = useEffectEvent(async (recoveryId?: string) => {
    const generation = analysisGenerationRef.current
    try {
      if (recoveryId) {
        const draft = await readRecoveredSurveyDraft()
        if (generation !== analysisGenerationRef.current) return
        if (draft) {
          setSurveyAnswer(draft.answers)
          setSurveyDefinitionId(draft.definitionId)
          setRecoveredSurveyPending(true)
        }
        setResult(null)
        return
      }
      const stored = await readAnalysisResultFromBrowser()
      if (generation !== analysisGenerationRef.current) return
      if (stored.ok !== true) {
        setResultRestorationFailed(true)
        return
      }
      const storedResult = stored.result
      if (storedResult) {
        const recorded = await waitForTabOperation(
          recordResultPresentationAction(
            storedResult.analysisId,
            getTabToken(),
          ),
        )
        if (generation !== analysisGenerationRef.current) return
        if (recorded.ok !== true) {
          setResultRestorationFailed(true)
          return
        }
      }
      setResult(storedResult)
      if (storedResult) {
        const view = sessionStorage.getItem("aerpp-survey-view")
        if (
          !storedResult.surveySubmitted &&
          (view === storedResult.analysisId || storedResult.pendingSurveyAnswer)
        )
          setStepState((current) =>
            current.step === RootStep.thanks
              ? current
              : { ...current, step: RootStep.survey },
          )
      }
      if (storedResult?.pendingSurveyAnswer && !storedResult.surveySubmitted)
        setSurveyAnswer(storedResult.pendingSurveyAnswer)

      // Missing output can belong to an analysis still running in another tab.
      // Hydration must not change its session; recovery is an explicit intent.
    } catch {
      // Keep the current screen's reload and recovery controls available.
      if (generation === analysisGenerationRef.current)
        setResultRestorationFailed(true)
    } finally {
      if (generation === analysisGenerationRef.current)
        setIsRestoringResult(false)
    }
  })

  const cancelOrdinaryWork = useCallback(() => {
    if (ordinaryAdmissionRef.current) {
      ordinaryAdmissionRef.current = false
      ordinaryGenerationRef.current += 1
      pendingCleanupRef.current = null
      invalidateAnalysisWork()
      setAnalysisJob(null)
    }
  }, [invalidateAnalysisWork])
  const sessionAdmission = useSessionAdmission(cancelOrdinaryWork)
  useEffect(() => {
    if (!sessionAdmission.initialStep && sessionAdmission.status === "ready") {
      void loadStoredState()
    } else if (
      sessionAdmission.initialStep?.ok === true &&
      sessionAdmission.status === "ready"
    ) {
      const next = readIntroView(sessionAdmission.initialStep.stepState)
      setStepState(next)
      documentDraftEnabledRef.current = next.step === RootStep.document
      setRecoveredSurveyAnalysisId(
        sessionAdmission.initialStep.recoveredSurveyAnalysisId,
      )
      void loadStoredState(
        sessionAdmission.initialStep.recoveredSurveyAnalysisId,
      )
    }
  }, [sessionAdmission.initialStep, sessionAdmission.status])

  const state = useMemo(
    () => ({
      withdrawalCleanupStatus,
      stepState,
      stage: stepState.stage,
      rootStep: stepState.step,
      analysisJob,
      result,
      recoveredSurveyAnalysisId,
      recoveredSurveyPending,
      isRestoringResult,
      resultRestorationFailed,
      surveyAnswer,
      surveyDefinitionId,
      consentDraft,
      documentDraft,
      analysisStatus:
        sessionAdmission.initialStep?.ok === true
          ? sessionAdmission.initialStep.analysisStatus
          : undefined,
      sessionAdmission: sessionAdmission.status,
      canRetrySessionAdmission: sessionAdmission.canRetryAdmission,
    }),
    [
      withdrawalCleanupStatus,
      stepState,
      analysisJob,
      result,
      recoveredSurveyAnalysisId,
      recoveredSurveyPending,
      isRestoringResult,
      resultRestorationFailed,
      surveyAnswer,
      surveyDefinitionId,
      consentDraft,
      documentDraft,
      sessionAdmission.status,
      sessionAdmission.canRetryAdmission,
      sessionAdmission.initialStep,
    ],
  )
  const stateRef = useRef(state)
  stateRef.current = state

  const updateDocumentDraft = useCallback<UpdateDocumentDraft>((update) => {
    if (documentDraftEnabledRef.current) {
      setDocumentDraft(update)
    }
  }, [])

  const clearClientState = useCallback(() => {
    setWithdrawalCleanupStatus("unconfirmed")
    resetGenerationRef.current += 1
    ordinaryGenerationRef.current += 1
    pendingCleanupRef.current = null
    documentDraftEnabledRef.current = false
    invalidateAnalysisWork()
    setRecoveredSurveyAnalysisId(undefined)
    setRecoveredSurveyPending(false)
    setStepState(INITIAL_STEP_STATE)
    setAnalysisJob(null)
    setResult(null)
    setSurveyAnswer({})
    setSurveyDefinitionId(undefined)
    setConsentDraft(EMPTY_CONSENT_DRAFT)
    setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
  }, [invalidateAnalysisWork])

  useEffect(() => {
    return subscribeBrowserState(() => {
      const scope = readTabGeneration(getTabToken())
      if (scope && isBrowserSessionCurrent(scope) !== true) {
        clearClientState()
        window.sessionStorage.clear()
      }
    })
  }, [clearClientState])

  const adoptStepTransition = useCallback((result: StepTransitionResult) => {
    if (result.ok !== true) {
      return {
        ok: false as const,
        reason: result.reason ?? "step_state_write_failed",
      }
    }

    documentDraftEnabledRef.current =
      result.stepState.step === RootStep.document
    setStepState(result.stepState)
    try {
      const scope = readTabGeneration(getTabToken())
      if (
        result.stepState.stage === Stage.unauthenticated &&
        [RootStep.start, RootStep.explanation, RootStep.consent].some(
          (step) => step === result.stepState.step,
        )
      )
        sessionStorage.setItem(
          `${INTRO_VIEW_PREFIX}${scope}`,
          result.stepState.step,
        )
      else sessionStorage.removeItem(`${INTRO_VIEW_PREFIX}${scope}`)
      if (result.stepState.step === RootStep.survey && stateRef.current.result)
        sessionStorage.setItem(
          "aerpp-survey-view",
          stateRef.current.result.analysisId,
        )
      else sessionStorage.removeItem("aerpp-survey-view")
    } catch {
      /* Per-tab navigation is recoverable from the completed result. */
    }
    if (result.stepState.stage !== Stage.unauthenticated) {
      setConsentDraft(EMPTY_CONSENT_DRAFT)
    }

    return { ok: true as const }
  }, [])

  const resetToStart = useCallback(async () => {
    const storage = await captureBrowserAnalysis()
    const adopted = adoptStepTransition(
      await awaitCurrentTransition(resetFlowAction(getTabToken())),
    )
    if (adopted.ok !== true) return adopted
    clearClientState()
    const cleared = await clearBrowserAnalysis(storage)
    return cleared === true
      ? { ok: true as const }
      : { ok: false as const, reason: "result_clear_failed" as const }
  }, [adoptStepTransition, awaitCurrentTransition, clearClientState])

  const moveToExplanation = useCallback(async () => {
    return adoptStepTransition(
      await awaitCurrentTransition(moveToExplanationAction(getTabToken())),
    )
  }, [adoptStepTransition, awaitCurrentTransition])

  const moveToOverview = useCallback(async () => {
    return adoptStepTransition(
      await awaitCurrentTransition(moveToOverviewAction(getTabToken())),
    )
  }, [adoptStepTransition, awaitCurrentTransition])

  const moveToConsent = useCallback(async () => {
    return adoptStepTransition(
      await awaitCurrentTransition(moveToConsentAction(getTabToken())),
    )
  }, [adoptStepTransition, awaitCurrentTransition])

  const correctConsentEmail = useCallback(async () => {
    const result = await awaitCurrentTransition(
      correctConsentEmailAction(getTabToken()),
    )
    if (result.ok === true) setConsentDraft(EMPTY_CONSENT_DRAFT)
    return adoptStepTransition(result)
  }, [adoptStepTransition, awaitCurrentTransition])

  const prepareConsent = useCallback(
    async (email: string) => {
      const result = await awaitCurrentTransition(
        prepareConsentContextAction(
          email,
          getTabToken(),
          readDisplayedDocumentSet().sha256,
        ),
      )
      if (result.ok !== true) return result
      return result.consentContext
        ? { ok: true as const, consentContext: result.consentContext }
        : { ok: false as const, reason: "consent_context_failed" }
    },
    [awaitCurrentTransition],
  )

  const completeConsent = useCallback(
    async (email: string, consentContext?: string) => {
      const transitioned = await awaitCurrentTransition(
        sendConsentEmailAndMoveToAuthAction(
          email,
          getTabToken(),
          consentContext,
        ),
      )
      const adopted = adoptStepTransition(transitioned)
      if (adopted.ok !== true) {
        return adopted
      }
      return { ok: true as const }
    },
    [adoptStepTransition, awaitCurrentTransition],
  )

  const confirmAuthentication = useCallback(async () => {
    const storage = await captureBrowserAnalysis()
    const transitioned = await awaitCurrentTransition(
      confirmAuthenticationAndPrepareAnalysisAction(getTabToken()),
    )
    const adopted = adoptStepTransition(transitioned)
    if (adopted.ok !== true) {
      return adopted
    }

    setRecoveredSurveyAnalysisId(
      transitioned.ok === true
        ? transitioned.recoveredSurveyAnalysisId
        : undefined,
    )
    setRecoveredSurveyPending(false)
    invalidateAnalysisWork()
    setAnalysisJob(null)
    setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
    setResult(null)
    setSurveyAnswer({})
    setSurveyDefinitionId(undefined)

    const resultCleared = await clearBrowserAnalysis(storage)
    if (resultCleared !== true) {
      return { ok: false as const, reason: "result_clear_failed" as const }
    }
    return { ok: true as const }
  }, [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork])

  const prepareNewAnalysis = useCallback(async () => {
    const generation = ordinaryGenerationRef.current
    const current = stateRef.current
    let cleanup = pendingCleanupRef.current
    if (cleanup) {
      cleanup.storage ??= await captureBrowserAnalysis()
      const status = await fetchSessionStatus(getTabToken() ?? "")
      if (
        generation !== ordinaryGenerationRef.current ||
        !ordinaryAdmissionRef.current
      )
        return { ok: false as const, reason: "superseded_operation" }
      if (!status?.admitted || status.withdrawing || status.analysisId !== null)
        return { ok: false as const, reason: "analysis_mismatch" }
    }
    if (!cleanup) {
      if (
        current.result?.pendingSurveyAnswer &&
        !current.result.surveySubmitted
      )
        return { ok: false as const, reason: "submission_pending" }
      if (
        current.result &&
        current.stage === Stage.authenticated &&
        !current.result.surveySubmitted
      )
        return { ok: false as const, reason: "initial_survey_required" }
      if (
        current.stage === Stage.followUp &&
        !current.result?.surveySubmitted &&
        Object.keys(current.surveyAnswer).length > 0 &&
        !window.confirm(
          "未送信のアンケート回答も破棄されます。ブラウザー内の一時データを消去しますか？",
        )
      )
        return { ok: false as const, reason: "cancelled" }
      const storage = await captureBrowserAnalysis()
      const transitioned = await awaitCurrentTransition(
        current.result || current.rootStep === RootStep.thanks
          ? prepareNewAnalysisAction(
              current.result?.analysisId ?? null,
              getTabToken(),
            )
          : failAnalysisAction(getTabToken()),
      )
      if (transitioned.ok !== true)
        return { ok: false as const, reason: transitioned.reason }
      cleanup = {
        stepState: transitioned.stepState,
        storage,
      }
      pendingCleanupRef.current = cleanup
    }
    invalidateAnalysisWork()
    setAnalysisJob(null)
    setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
    setResult(null)
    setSurveyAnswer({})
    setSurveyDefinitionId(undefined)
    const cleared = await clearBrowserAnalysis(cleanup.storage)
    if (
      generation !== ordinaryGenerationRef.current ||
      !ordinaryAdmissionRef.current
    )
      return { ok: false as const, reason: "superseded_operation" }
    if (cleared !== true) return { ok: true as const, resultCleared: false }
    adoptStepTransition({ ok: true, stepState: cleanup.stepState })
    pendingCleanupRef.current = null
    return { ok: true as const, resultCleared: true }
  }, [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork])

  const startAnalysis = useCallback(
    async (job: AnalysisJob) => {
      // Release before publishing the job, whose effect starts a guarded request.
      const transitioned = await awaitCurrentTransition(
        runSessionMutation(() => startAnalysisAction(getTabToken())),
      )
      const adopted = adoptStepTransition(transitioned)
      if (adopted.ok !== true) {
        return adopted
      }

      invalidateAnalysisWork()
      setResult(null)
      setAnalysisJob(job)
      return { ok: true as const }
    },
    [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork],
  )

  const observeAnalysisParticipation = useCallback(
    (kind: "initial" | "follow-up") => {
      if (
        isTabOperationCurrent() !== true ||
        stateRef.current.rootStep !== RootStep.result ||
        stateRef.current.result !== null
      )
        return
      setStepState((current) => ({
        ...current,
        stage: kind === "follow-up" ? Stage.followUp : Stage.authenticated,
      }))
    },
    [],
  )

  const failAnalysis = useCallback(async () => {
    const adopted = adoptStepTransition(
      await awaitCurrentTransition(failAnalysisAction(getTabToken())),
    )
    if (adopted.ok === true) invalidateAnalysisWork()
    return adopted
  }, [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork])

  const cancelAnalysis = useCallback(async () => {
    const adopted = adoptStepTransition(
      await awaitCurrentTransition(cancelAnalysisAction(getTabToken())),
    )
    if (adopted.ok === true) invalidateAnalysisWork()
    return adopted
  }, [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork])

  const recoverUnavailableAnalysis = useCallback(
    async (analysisId: string) => {
      if (stateRef.current.result !== null)
        return { ok: false as const, reason: "analysis_recovery_unavailable" }
      const storage = await captureBrowserAnalysis()
      const transitioned = await awaitCurrentTransition(
        recoverUnavailableAnalysisAction(analysisId, getTabToken()),
      )
      if (transitioned.ok !== true) return transitioned
      const generation = ordinaryGenerationRef.current
      invalidateAnalysisWork()
      const cleared = await clearBrowserAnalysis(storage)
      if (
        generation !== ordinaryGenerationRef.current ||
        isTabOperationCurrent() !== true
      )
        return { ok: false as const, reason: "superseded_operation" }
      if (cleared !== true)
        return { ok: false as const, reason: "result_clear_failed" }
      setAnalysisJob(null)
      setResult(null)
      return adoptStepTransition(transitioned)
    },
    [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork],
  )

  const completeAnalysis = useCallback(
    async (nextResult: AnalysisResult, signal?: AbortSignal) => {
      const generation = analysisGenerationRef.current
      if (signal?.aborted)
        return { ok: false as const, reason: "stale_analysis" as const }
      const stored = await runSessionMutation(() =>
        saveAnalysisResultInBrowser(nextResult, signal),
      )
      if (signal?.aborted || generation !== analysisGenerationRef.current) {
        return { ok: false as const, reason: "stale_analysis" as const }
      }
      if (stored.ok !== true && stored.reason === "storage_changed") {
        invalidateAnalysisWork()
        setAnalysisJob(null)
        setResult(null)
        return { ok: false as const, reason: stored.reason }
      }
      const resultStored = stored.ok === true
      if (resultStored === true) {
        const recorded = await waitForTabOperation(
          recordResultPresentationAction(nextResult.analysisId, getTabToken()),
        )
        if (
          recorded.ok !== true ||
          signal?.aborted ||
          generation !== analysisGenerationRef.current ||
          isTabOperationCurrent() !== true
        )
          return { ok: true as const, resultStored: false }
        setAnalysisJob(null)
        setResult(nextResult)
        // Confirmed storage and Firestore presentation permit display. RAM cleanup
        // uses a bounded request outside the serialized Server Function dispatcher.
        void acknowledgeAnalysisResult(nextResult.analysisId).catch(
          () => undefined,
        )
      }
      return { ok: true as const, resultStored }
    },
    [invalidateAnalysisWork],
  )

  const startSurvey = useCallback(async () => {
    if (stateRef.current.result === null) {
      return { ok: false as const, reason: "no_result" as const }
    }
    const transitioned = await awaitCurrentTransition(
      startSurveyAction(stateRef.current.result.analysisId, getTabToken()),
    )
    const adopted = adoptStepTransition(transitioned)
    if (adopted.ok !== true) {
      return adopted
    }
    return { ok: true as const }
  }, [adoptStepTransition, awaitCurrentTransition])

  const updateSurveyAnswer = useCallback(
    (name: string, value: string, definitionId?: string) => {
      if (
        stateRef.current.result?.pendingSurveyAnswer ||
        stateRef.current.recoveredSurveyPending === true ||
        stateRef.current.result?.surveySubmitted
      )
        return
      if (
        stateRef.current.surveyDefinitionId !== undefined &&
        stateRef.current.surveyDefinitionId !== definitionId
      )
        return
      setSurveyDefinitionId(definitionId)
      setSurveyAnswer((currentSurveyAnswer) => ({
        ...currentSurveyAnswer,
        [name]: value,
      }))
    },
    [],
  )

  const returnToResult = useCallback(async () => {
    return adoptStepTransition(
      await awaitCurrentTransition(returnToResultAction(getTabToken())),
    )
  }, [adoptStepTransition, awaitCurrentTransition])

  const completeSurveySubmission = useCallback(
    async (validatedSurveyAnswer: SurveyAnswer, definitionId: string) => {
      const currentResult = stateRef.current.result
      if (
        stateRef.current.surveyDefinitionId !== undefined &&
        stateRef.current.surveyDefinitionId !== definitionId
      )
        return { ok: false as const, reason: "questionnaire_changed" }
      const recoveredId = stateRef.current.recoveredSurveyAnalysisId
      if (!currentResult && recoveredId) {
        try {
          const generation = analysisGenerationRef.current
          const prepared = await freezeRecoveredSurveyDraft({
            analysisId: recoveredId,
            definitionId,
            answers: validatedSurveyAnswer,
          })
          const draft = prepared.draft
          if (generation !== analysisGenerationRef.current)
            return { ok: false as const, reason: "analysis_mismatch" }
          setSurveyAnswer(draft.answers)
          setSurveyDefinitionId(draft.definitionId)
          setRecoveredSurveyPending(true)
          const transitioned = await awaitCurrentTransition(
            completeSurveySubmissionAction(
              draft.answers,
              recoveredId,
              draft.definitionId,
              getTabToken(),
            ),
          )
          const adopted = adoptStepTransition(transitioned)
          if (adopted.ok !== true) return adopted
          // Acceptance ends the frozen questionnaire even if optional browser
          // cleanup fails. Do not mutate the next screen after that async cleanup.
          setRecoveredSurveyAnalysisId(undefined)
          setRecoveredSurveyPending(false)
          setSurveyAnswer({})
          setSurveyDefinitionId(undefined)
          const cleared = await clearRecoveredSurveyDraft(
            prepared.sealed,
          ).catch(() => false)
          if (generation !== analysisGenerationRef.current)
            return { ok: false as const, reason: "superseded_operation" }
          if (cleared !== true)
            return { ok: true as const, localCleanupFailed: true as const }
          return { ok: true as const }
        } catch {
          return { ok: false as const, reason: "survey_retry_storage_failed" }
        }
      }
      if (!currentResult) return { ok: false as const, reason: "no_result" }
      const analysisId = currentResult.analysisId
      const generation = analysisGenerationRef.current
      const prepared = await prepareSurveySubmissionInBrowser(
        currentResult,
        validatedSurveyAnswer,
        definitionId,
      )
      if (generation !== analysisGenerationRef.current) {
        return { ok: false as const, reason: "analysis_mismatch" }
      }
      if (prepared.ok !== true) {
        return {
          ok: false as const,
          reason:
            prepared.reason === "write_failed"
              ? "survey_retry_storage_failed"
              : prepared.reason === "survey_already_submitted" ||
                  prepared.reason === "questionnaire_changed" ||
                  prepared.reason === "questionnaire_check_failed"
                ? prepared.reason
                : "analysis_mismatch",
        }
      }
      setResult(prepared.result)
      setSurveyAnswer(prepared.result.pendingSurveyAnswer)
      setSurveyDefinitionId(prepared.result.pendingQuestionnaireId)
      const transitioned = await awaitCurrentTransition(
        completeSurveySubmissionAction(
          prepared.result.pendingSurveyAnswer,
          analysisId,
          prepared.result.pendingQuestionnaireId,
          getTabToken(),
        ),
      )
      const adopted = adoptStepTransition(transitioned)
      if (adopted.ok !== true) {
        return adopted
      }

      setAnalysisJob(null)
      setResult({ ...prepared.result, surveySubmitted: true })
      setSurveyAnswer({})
      setSurveyDefinitionId(undefined)
      return { ok: true as const }
    },
    [adoptStepTransition, awaitCurrentTransition],
  )

  const completeWithdrawal = useCallback(
    async (email?: string, checkOnly = false) => {
      const generation = resetGenerationRef.current
      const storage = await captureBrowserAnalysis()
      if (email !== undefined && !checkOnly) {
        // The action returns sealed retry context. Store it before the external
        // withdrawal action; a storage failure must not withdraw participation.
        const prepared = await waitForTabOperation(
          prepareWithdrawalAction(
            email,
            getTabToken(),
            readDisplayedDocumentSet().sha256,
          ),
        )
        if (prepared.ok !== true)
          return {
            ok: false as const,
            reason: prepared.reason ?? "withdraw_failed",
          }
      }
      const transitioned = await awaitCurrentTransition(
        checkOnly
          ? readWithdrawalCleanupAction(getTabToken())
          : email === undefined
            ? retryWithdrawalCleanupAction(getTabToken())
            : completeWithdrawalAction(email, getTabToken()),
        true,
      )
      const adopted = adoptStepTransition(transitioned)
      if (adopted.ok !== true) {
        return adopted
      }

      invalidateAnalysisWork()
      setAnalysisJob(null)
      setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
      setResult(null)
      setSurveyAnswer({})
      setSurveyDefinitionId(undefined)
      setWithdrawalCleanupStatus("unconfirmed")
      const resultCleared = (await clearBrowserAnalysis(storage)) === true
      if (generation === resetGenerationRef.current) {
        setWithdrawalCleanupStatus(
          transitioned.ok === true && transitioned.withdrawalStateWriteFailed
            ? "stateFailed"
            : transitioned.ok === true && transitioned.withdrawalCleanupPending
              ? "pending"
              : !resultCleared
                ? "localFailed"
                : "complete",
        )
      }
      return {
        ok: true as const,
        cleanupPending:
          transitioned.ok === true &&
          transitioned.withdrawalCleanupPending === true,
        stateWriteFailed:
          transitioned.ok === true &&
          transitioned.withdrawalStateWriteFailed === true,
        resultCleared,
      }
    },
    [adoptStepTransition, awaitCurrentTransition, invalidateAnalysisWork],
  )

  const actions = useMemo(
    () => ({
      retrySessionAdmission: sessionAdmission.retryAdmission,
      clearClientState,
      resetToStart: guardSessionMutation(resetToStart),
      moveToExplanation: guardSessionMutation(moveToExplanation),
      moveToOverview: guardSessionMutation(moveToOverview),
      moveToConsent: guardSessionMutation(moveToConsent),
      correctConsentEmail: guardSessionMutation(correctConsentEmail),
      prepareConsent: guardSessionMutation(prepareConsent),
      completeConsent: guardSessionMutation(completeConsent),
      confirmAuthentication: guardSessionMutation(confirmAuthentication),
      prepareNewAnalysis: guardSessionMutation(prepareNewAnalysis),
      startAnalysis,
      observeAnalysisParticipation,
      failAnalysis: guardSessionMutation(failAnalysis),
      recoverUnavailableAnalysis: guardSessionMutation(
        recoverUnavailableAnalysis,
      ),
      cancelAnalysis: () => runSessionMutation(cancelAnalysis),
      completeAnalysis,
      startSurvey: guardSessionMutation(startSurvey),
      updateSurveyAnswer,
      updateConsentDraft,
      updateDocumentDraft,
      returnToResult: guardSessionMutation(returnToResult),
      completeSurveySubmission: guardSessionMutation(completeSurveySubmission),
      completeWithdrawal,
      readWithdrawalCleanup: () => completeWithdrawal(undefined, true),
    }),
    [
      sessionAdmission.retryAdmission,
      clearClientState,
      resetToStart,
      moveToExplanation,
      moveToOverview,
      moveToConsent,
      correctConsentEmail,
      prepareConsent,
      completeConsent,
      confirmAuthentication,
      prepareNewAnalysis,
      startAnalysis,
      observeAnalysisParticipation,
      failAnalysis,
      recoverUnavailableAnalysis,
      cancelAnalysis,
      completeAnalysis,
      startSurvey,
      updateSurveyAnswer,
      updateConsentDraft,
      updateDocumentDraft,
      returnToResult,
      completeSurveySubmission,
      completeWithdrawal,
    ],
  )

  return (
    <AppContext.Provider value={{ state, actions }}>
      {(sessionAdmission.status === "checking" ||
        sessionAdmission.status === "unavailable") &&
      stepState.stage !== Stage.withdrawn &&
      !["/withdraw", "/license", "/download", "/reset", "/recovery"].includes(
        pathname,
      ) ? (
        <section role="status" className="space-y-4">
          <p>
            {sessionAdmission.status === "checking"
              ? "セッションの状態を確認しています..."
              : sessionAdmission.canRetryAdmission === true
                ? SESSION_ADMISSION_RETRY_MESSAGE
                : "現在の画面とセッションの状態が一致しないか、セッションを確認できません。ページを再読み込みして現在の状態を確認してください。"}
          </p>
          {sessionAdmission.status === "unavailable" &&
            (sessionAdmission.canRetryAdmission === true ? (
              <ActionButton
                variant="secondary"
                onClick={sessionAdmission.retryAdmission}
              >
                セッションの確認を再試行
              </ActionButton>
            ) : (
              <>
                <p>{SESSION_RELOAD_NOTICE}</p>
                <ActionButton
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  ページを再読み込み
                </ActionButton>
              </>
            ))}
          <a
            href="/withdraw"
            className="block text-sm underline underline-offset-4"
          >
            同意の撤回
          </a>
          <p>
            初回の結果を失った場合や再開できない場合は、研究者にご連絡ください。
          </p>
        </section>
      ) : (
        children
      )}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const context = use(AppContext)
  if (!context) throw new Error("useAppContext requires AppContextProvider")
  const { state, actions } = context

  return {
    ...state,
    ...actions,
  }
}

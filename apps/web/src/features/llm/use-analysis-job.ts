"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { AnalysisResult } from "@/features/app-context/analysis-result-types"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { RootStep } from "@/features/app-context/root-step-types"
import type { AnalysisDocument } from "@/features/document/analysis-document-types"
import { finalizeAnalysisAction } from "@/features/llm/actions-finalize-analysis"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import { runSessionMutation } from "@/lib/session-mutation"
import { isTabOperationCurrent } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import {
  retryAnalysisAction,
  retryAnalysisJobRecordingAction,
} from "./actions-analysis-job"
import { requestAnalysisJob, waitForAnalysisPoll } from "./analysis-job-client"
import {
  type AnalysisJobStatus,
  analysisNotStartedSchema,
} from "./analysis-job-types"

export function useAnalysisJob() {
  const {
    analysisJob,
    analysisStatus,
    observeAnalysisParticipation,
    isRestoringResult,
    cancelAnalysis,
    completeAnalysis,
    failAnalysis,
    recoverUnavailableAnalysis,
    rootStep,
    result,
  } = useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const [failedAnalysis, setFailedAnalysis] = useState<{
    jobId: string
    message: string
  } | null>(null)
  const [observation, setObservation] = useState<
    (AnalysisJobStatus & { receivedAtMs: number }) | null
  >(null)
  const [connectionLost, setConnectionLost] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [isRecoveringAnalysis, setIsRecoveringAnalysis] = useState(false)
  const [pendingCompletion, setPendingCompletion] = useState<{
    jobId: string
    text: string
    receipt: string
  } | null>(null)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const finalizingRef = useRef(false)
  const mountedRef = useRef(false)
  const recoveryAttemptRef = useRef<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const admissionRef = useRef<ReturnType<typeof requestAnalysisJob> | null>(
    null,
  )
  const startedJobIdRef = useRef<string | null>(null)
  const lastConnectionAttemptRef = useRef(0)
  const observationOnlyJobIdsRef = useRef(new Set<string>())

  const currentJobId = analysisJob?.jobId ?? "resume"
  const canObserve =
    analysisJob !== null ||
    ["running", "unconfirmed", "completed", "failed", "cancelled"].includes(
      analysisStatus ?? "",
    )
  const hasPendingCompletion =
    pendingCompletion?.jobId === currentJobId ||
    observation?.status === "completion_pending"
  const hasPendingTermination = observation?.status === "termination_pending"
  const resultText = result?.text ?? ""
  useEffect(() => {
    if (observation?.analysisId && observation.questionnaireKind)
      observeAnalysisParticipation(observation.questionnaireKind)
  }, [observation, observeAnalysisParticipation])
  const hasFailedAnalysis = failedAnalysis?.jobId === currentJobId
  const isAnalysisRunning =
    rootStep === RootStep.result &&
    result === null &&
    canObserve &&
    isRestoringResult !== true &&
    hasFailedAnalysis !== true &&
    hasPendingCompletion !== true &&
    hasPendingTermination !== true &&
    connectionLost !== true
  const isWaitingForResult =
    isAnalysisRunning && observation?.status !== "recording"
  const hasCompletedResult = result !== null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const controller = abortControllerRef.current
      abortControllerRef.current = null
      startedJobIdRef.current = null
      controller?.abort()
    }
  }, [])

  function getJobDocumentList(
    documents: Record<string, string>,
    names: Record<string, string>,
  ): AnalysisDocument[] {
    return Object.entries(documents)
      .filter(([, text]) => text.trim() !== "")
      .map(([key, text]) => ({
        name: names[key]?.trim() || "書類",
        text: text.trim(),
      }))
  }

  useEffect(() => {
    if (rootStep === RootStep.result && canObserve === true && !result) {
      return
    }

    startedJobIdRef.current = null
    setPendingCompletion(null)
    const controller = abortControllerRef.current
    if (!controller) {
      return
    }

    abortControllerRef.current = null
    controller.abort()
  }, [canObserve, result, rootStep])

  async function recoverFailedAnalysis(message: string) {
    const recoveryMessage = `${message} 書類の準備に戻れませんでした。下のボタンから再度お試しください。`
    setIsRecoveringAnalysis(true)
    try {
      const transition = await failAnalysis()
      if (mountedRef.current !== true || !isTabOperationCurrent()) return
      updateStatusMessage(
        transition.ok === true
          ? { message, tone: "error" }
          : (getSessionFailureStatus(transition.reason) ?? {
              message: recoveryMessage,
              tone: "error",
            }),
      )
    } catch {
      updateStatusMessage({ message: recoveryMessage, tone: "error" })
    } finally {
      setIsRecoveringAnalysis(false)
    }
  }

  const recoverUnavailableResult = useEffectEvent(async () => {
    const id = observation?.analysisId
    if (
      !id ||
      observation?.canRecover !== true ||
      isTabOperationCurrent() !== true
    )
      return
    setIsRecoveringAnalysis(true)
    updateStatusMessage({
      message:
        "表示前の解析結果を取得できないため、書類の準備に戻ります。再読み込み後は書類を入力し直してください。",
      tone: "warning",
    })
    try {
      const recovered = await recoverUnavailableAnalysis(id)
      if (mountedRef.current !== true || isTabOperationCurrent() !== true)
        return
      if (recovered.ok !== true)
        updateStatusMessage(
          recovered.reason === "result_clear_failed"
            ? {
                message:
                  "書類の準備へ戻る処理は受理されましたが、ブラウザー内の解析結果を消去できませんでした。ブラウザーの保存設定を確認し、再読み込みして現在の状態を確認してください。",
                tone: "error",
                recovery: "reload",
              }
            : (getSessionFailureStatus(recovered.reason) ?? {
                message:
                  "書類の準備への復帰を確認できませんでした。「接続を再確認」から同じ解析の状態と復帰条件を確認し直してください。",
                tone: "error",
              }),
        )
    } catch {
      if (mountedRef.current === true && isTabOperationCurrent())
        updateStatusMessage({
          message: "書類の準備に戻れませんでした。接続を再確認してください。",
          tone: "error",
        })
    } finally {
      if (mountedRef.current === true) setIsRecoveringAnalysis(false)
    }
  })

  useEffect(() => {
    if (
      rootStep !== RootStep.result ||
      result !== null ||
      isRestoringResult === true ||
      observation?.status !== "unavailable" ||
      observation.canRecover !== true ||
      !observation.analysisId ||
      recoveryAttemptRef.current === observation.analysisId
    )
      return
    recoveryAttemptRef.current = observation.analysisId
    void recoverUnavailableResult()
  }, [rootStep, result, isRestoringResult, observation])

  async function finalizeCompletion(
    completion: NonNullable<typeof pendingCompletion>,
    controller: AbortController,
  ) {
    const isCurrent = () =>
      !controller.signal.aborted &&
      startedJobIdRef.current === completion.jobId &&
      isTabOperationCurrent()
    if (finalizingRef.current || !isCurrent()) return
    finalizingRef.current = true
    setIsFinalizing(true)
    const failureMessage =
      "解析結果を保持しています。完了処理を確認できませんでした。時間をおいて「完了処理を再試行」を押してください。"
    try {
      const finalized = await runSessionMutation(() =>
        finalizeAnalysisAction(completion.receipt, getTabToken()),
      )
      if (!isCurrent()) return
      if (!finalized.ok) {
        updateStatusMessage(
          getSessionFailureStatus(finalized.reason) ?? {
            message: failureMessage,
            tone: "error",
          },
        )
        return
      }
      const newResult: AnalysisResult = {
        ...finalized.metadata,
        text: completion.text,
      }
      const stored = await completeAnalysis(newResult, controller.signal)
      if (!isCurrent()) return
      if (stored.ok !== true && stored.reason === "session_busy") {
        // Busy state has not invalidated this output or its completion receipt.
        updateStatusMessage(getSessionFailureStatus(stored.reason))
        return
      }
      if (stored.ok !== true && stored.reason === "storage_changed") {
        setPendingCompletion(null)
        updateStatusMessage({
          message:
            "別のタブで保存データが変更されたため、この解析結果は保存していません。ページを再読み込みして現在の結果を確認してください。",
          tone: "error",
          recovery: "reload",
        })
        return
      }
      if (!stored.ok || !stored.resultStored) {
        updateStatusMessage({ message: failureMessage, tone: "error" })
        return
      }
      setPendingCompletion(null)
      updateStatusMessage(null)
    } catch {
      if (isCurrent())
        updateStatusMessage({ message: failureMessage, tone: "error" })
    } finally {
      finalizingRef.current = false
      setIsFinalizing(false)
    }
  }

  async function retryCompletion() {
    if (
      (hasPendingCompletion !== true && hasPendingTermination !== true) ||
      finalizingRef.current ||
      rootStep !== RootStep.result ||
      !isTabOperationCurrent()
    )
      return
    if (pendingCompletion) {
      const controller = new AbortController()
      abortControllerRef.current?.abort()
      abortControllerRef.current = controller
      try {
        await finalizeCompletion(pendingCompletion, controller)
      } finally {
        if (abortControllerRef.current === controller)
          abortControllerRef.current = null
      }
      return
    }
    if (observation?.analysisId) {
      finalizingRef.current = true
      setIsFinalizing(true)
      const failureMessage =
        hasPendingTermination === true
          ? "解析の終了記録を確認できませんでした。解析はやり直さず、時間をおいて再試行してください。"
          : "解析結果は保持しています。終了記録を確認できませんでした。時間をおいて再試行してください。"
      try {
        const retried = await runSessionMutation(() =>
          retryAnalysisJobRecordingAction(
            observation.analysisId,
            getTabToken(),
          ),
        )
        if (mountedRef.current !== true || !isTabOperationCurrent()) return
        if (retried.ok !== true) {
          if (retried.reason === "result_unavailable") {
            setObservation(null)
            startedJobIdRef.current = null
            setConnectionAttempt((value) => value + 1)
          }
          updateStatusMessage({
            message:
              retried.reason === "result_unavailable"
                ? "保持期限を過ぎたかサーバーが再起動したため、終了記録を再送できません。同じ解析の状態と復帰条件を確認し直しています。"
                : failureMessage,
            tone: "error",
          })
          return
        }
        setObservation(null)
        setConnectionLost(false)
        startedJobIdRef.current = null
        setConnectionAttempt((value) => value + 1)
      } catch {
        if (mountedRef.current === true && isTabOperationCurrent())
          updateStatusMessage({
            message: failureMessage,
            tone: "error",
          })
      } finally {
        finalizingRef.current = false
        setIsFinalizing(false)
      }
    }
  }

  function retryConnection() {
    recoveryAttemptRef.current = null
    setObservation(null)
    setConnectionLost(false)
    startedJobIdRef.current = null
    setConnectionAttempt((value) => value + 1)
    updateStatusMessage(null)
  }

  function observeUnconfirmedMutation(message: string) {
    // A missing mutation response cannot authorize another model request.
    setFailedAnalysis(null)
    setObservation(null)
    setConnectionLost(true)
    updateStatusMessage({ message, tone: "error" })
  }

  async function retryAnalysis() {
    if (observation?.canRetry !== true || !observation.analysisId) return
    setIsRecoveringAnalysis(true)
    try {
      const retried = await runSessionMutation(() =>
        retryAnalysisAction(observation.analysisId, getTabToken()),
      )
      if (mountedRef.current !== true || !isTabOperationCurrent()) return
      if (retried.ok !== true) {
        if (analysisNotStartedSchema.safeParse(retried).success === true) {
          updateStatusMessage({
            message:
              "開始前の確認に失敗したため、再解析は開始していません。時間をおいて再試行してください。",
            tone: "error",
          })
          return
        }
        if (retried.reason === "retry_unavailable") {
          setObservation({ ...observation, canRetry: false })
          updateStatusMessage({
            message:
              "保持しているプロンプトを取得できません。書類の準備に戻って、書類を入力し直してください。",
            tone: "error",
          })
        } else {
          const sessionFailure = getSessionFailureStatus(retried.reason)
          if (sessionFailure !== null) updateStatusMessage(sessionFailure)
          else
            observeUnconfirmedMutation(
              "再解析の開始を確認できませんでした。すでに開始している可能性があります。「接続を再確認」で同じ解析の状態を確認してください。",
            )
        }
        return
      }
      setObservation({ ...retried, receivedAtMs: performance.now() })
      setFailedAnalysis(null)
      setConnectionLost(false)
      startedJobIdRef.current = null
      setConnectionAttempt((value) => value + 1)
      updateStatusMessage(null)
    } catch {
      if (mountedRef.current === true && isTabOperationCurrent())
        observeUnconfirmedMutation(
          "再解析の開始を確認できませんでした。すでに開始している可能性があります。「接続を再確認」で同じ解析の状態を確認してください。",
        )
    } finally {
      setIsRecoveringAnalysis(false)
    }
  }

  async function stopAnalysis() {
    if (isCancelling === true) return
    setIsCancelling(true)
    const controller = abortControllerRef.current
    const admission = admissionRef.current
    // Reconnection after cancellation must never submit this draft again.
    observationOnlyJobIdsRef.current.add(currentJobId)
    if (admission === null) controller?.abort()
    try {
      // Admission changes the hash. Receive its token before cancelling, while
      // stopping read-only observation before the cancellation can change it again.
      if (admission !== null) await admission
      controller?.abort()
      if (mountedRef.current !== true || isTabOperationCurrent() !== true)
        return
      const stopped = await cancelAnalysis()
      if (mountedRef.current !== true || !isTabOperationCurrent()) return
      if (stopped.ok !== true) {
        if (
          stopped.reason === "analysis_termination_pending" ||
          stopped.reason === "analysis_completed"
        ) {
          // Observe the same attempt, including completion that won the race.
          retryConnection()
          return
        }
        const sessionFailure = getSessionFailureStatus(stopped.reason)
        if (sessionFailure !== null) {
          setConnectionLost(true)
          updateStatusMessage(sessionFailure)
        } else
          observeUnconfirmedMutation(
            "解析の中止を確認できませんでした。「接続を再確認」で同じ解析の終了状態を確認してください。",
          )
        return
      }
      updateStatusMessage({ message: "解析を中止しました。" })
    } catch {
      if (mountedRef.current === true && isTabOperationCurrent())
        observeUnconfirmedMutation(
          "解析の中止を確認できませんでした。「接続を再確認」で同じ解析の終了状態を確認してください。",
        )
    } finally {
      controller?.abort()
      setIsCancelling(false)
    }
  }

  const runAnalysis = useEffectEvent(
    async (
      documents: Record<string, string>,
      names: Record<string, string>,
      controller: AbortController,
      currentJobId: string,
    ) => {
      function failCurrentAnalysis(message: string) {
        // A late failure must not reset a newer analysis completed in another tab.
        setFailedAnalysis({ jobId: currentJobId, message })
        updateStatusMessage({ message, tone: "error" })
      }
      try {
        const documentList = getJobDocumentList(documents, names)
        let status = await requestAnalysisJob({ signal: controller.signal })
        if (!("status" in status))
          throw new Error("解析状態を確認できませんでした。")
        if (
          status.status === "idle" &&
          documentList.length > 0 &&
          observationOnlyJobIdsRef.current.has(currentJobId) !== true
        ) {
          observationOnlyJobIdsRef.current.add(currentJobId)
          const admission = requestAnalysisJob({
            documents: documentList,
            signal: controller.signal,
          })
          admissionRef.current = admission
          try {
            status = await admission
          } finally {
            if (admissionRef.current === admission) admissionRef.current = null
          }
        }
        while (
          "status" in status &&
          (status.status === "running" || status.status === "recording")
        ) {
          if (controller.signal.aborted || isTabOperationCurrent() !== true)
            return
          setObservation({ ...status, receivedAtMs: performance.now() })
          await waitForAnalysisPoll(controller.signal)
          status = await requestAnalysisJob({ signal: controller.signal })
        }
        if ("reason" in status && status.ok === false) {
          if (controller.signal.aborted || isTabOperationCurrent() !== true)
            return
          failCurrentAnalysis(
            "開始前の確認で、解析に必要な接続または保存先を利用できませんでした。解析は開始していません。入力は保持しています。書類の準備に戻り、時間をおいて再度お試しください。",
          )
          return
        }
        if (!("status" in status))
          throw new Error("解析状態を確認できませんでした。")
        if (controller.signal.aborted || isTabOperationCurrent() !== true)
          return
        setObservation({ ...status, receivedAtMs: performance.now() })
        if (status.status === "termination_pending") {
          updateStatusMessage({
            message:
              "解析は終了しています。終了記録を確認できないため、「終了記録を再試行」を押してください。解析はやり直しません。",
            tone: "error",
          })
          return
        }
        if (status.status === "completion_pending") {
          updateStatusMessage({
            message:
              "解析結果は保持しています。終了記録の確認が必要です。「完了処理を再試行」を押してください。",
            tone: "error",
          })
          return
        }
        if (
          status.status === "unconfirmed" ||
          status.status === "unavailable" ||
          status.status === "idle"
        ) {
          setConnectionLost(true)
          updateStatusMessage({
            message:
              status.status === "unavailable"
                ? status.canRecover === true
                  ? "表示前の解析結果を取得できないため、書類の準備に戻ります。"
                  : "解析結果を取得できません。初回解析の結果を失った場合は、再解析せず研究者にご連絡ください。"
                : "解析の終了状態を確認できません。自動で再解析せず、接続を再確認してください。",
            tone: "error",
          })
          return
        }
        if (status.status === "failed" || status.status === "cancelled") {
          failCurrentAnalysis(
            status.reason === "timeout"
              ? "解析の制限時間を超えました。"
              : "解析が終了しましたが、正常な結果を取得できませんでした。",
          )
          return
        }
        if (!status.analysisId)
          throw new Error("解析状態を確認できませんでした。")
        const output = await requestAnalysisJob({
          analysisId: status.analysisId,
          signal: controller.signal,
        })
        if (!("text" in output))
          throw new Error("解析結果を取得できませんでした。")
        const finalizedText = output.text.trim()
        const completionReceipt = output.receipt
        const completion = {
          jobId: currentJobId,
          text: finalizedText,
          receipt: completionReceipt,
        }
        setPendingCompletion(completion)
        await finalizeCompletion(completion, controller)
      } catch {
        if (!isTabOperationCurrent()) return
        if (controller.signal.aborted) return
        setConnectionLost(true)
        updateStatusMessage({
          message:
            "通信状況を確認できません。解析が続いている可能性があります。「接続を再確認」を押してください。",
          tone: "error",
        })
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
          if (
            controller.signal.aborted &&
            startedJobIdRef.current === currentJobId
          ) {
            startedJobIdRef.current = null
          }
        }
      }
    },
  )

  useEffect(() => {
    if (
      rootStep !== RootStep.result ||
      canObserve !== true ||
      result ||
      isRestoringResult === true ||
      hasFailedAnalysis === true ||
      hasPendingCompletion === true ||
      hasPendingTermination === true ||
      isCancelling === true ||
      connectionLost === true
    )
      return
    if (
      startedJobIdRef.current === currentJobId &&
      lastConnectionAttemptRef.current === connectionAttempt
    )
      return
    lastConnectionAttemptRef.current = connectionAttempt
    startedJobIdRef.current = currentJobId
    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller
    updateStatusMessage(null)
    void runAnalysis(
      analysisJob?.documents ?? {},
      analysisJob?.documentNames ?? {},
      controller,
      currentJobId,
    )
  }, [
    analysisJob,
    canObserve,
    result,
    rootStep,
    isRestoringResult,
    hasFailedAnalysis,
    hasPendingCompletion,
    hasPendingTermination,
    isCancelling,
    connectionLost,
    currentJobId,
    connectionAttempt,
    updateStatusMessage,
  ])

  return {
    resultText,
    elapsedTime:
      observation !== null && observation.elapsedMs !== null
        ? {
            elapsedMs: observation.elapsedMs,
            receivedAtMs: observation.receivedAtMs,
          }
        : null,
    jobStatus: observation?.status ?? null,
    connectionLost,
    retryConnection,
    retryAnalysis,
    canRetryAnalysis: observation?.canRetry === true,
    stopAnalysis,
    isCancelling,
    hasPendingCompletion,
    hasPendingTermination,
    hasCompletedResult,
    hasFailedAnalysis,
    failedAnalysis,
    isAnalysisRunning,
    isWaitingForResult,
    isRecoveringAnalysis,
    isFinalizing,
    retryCompletion,
    recoverFailedAnalysis,
  }
}

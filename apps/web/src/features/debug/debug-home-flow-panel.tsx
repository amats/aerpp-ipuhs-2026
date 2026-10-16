"use client"

import { useAppContext } from "@/features/app-context/app-context-provider"
import { useStoredAnalysisPresence } from "@/features/home-flow/use-stored-analysis-presence"
import DebugSnapshotPanel from "./debug-snapshot-panel"

type HomeFlowDebugSnapshot = {
  appContext: {
    stage: string
    rootStep: string
    hasAnalysisJob: boolean
    analysisJobId: string | null
    analysisId: string | null
    hasResult: boolean
    resultSurveySubmitted: boolean
    recoveredSurvey: boolean
    recoveredSurveyPending: boolean
    isRestoringResult: boolean
    resultRestorationFailed: boolean
    withdrawalCleanupStatus: string
    sessionAdmission: string | null
    surveyAnswerKeys: string[]
  }
  browserResult: ReturnType<typeof useStoredAnalysisPresence>["analysisResult"]
}

export default function DebugHomeFlowPanel() {
  const {
    stage,
    rootStep,
    analysisJob,
    result,
    recoveredSurveyAnalysisId,
    recoveredSurveyPending,
    isRestoringResult,
    resultRestorationFailed,
    withdrawalCleanupStatus,
    sessionAdmission,
    surveyAnswer,
  } = useAppContext()

  const snapshot: HomeFlowDebugSnapshot = {
    appContext: {
      stage,
      rootStep,
      hasAnalysisJob: analysisJob !== null,
      analysisJobId: analysisJob?.jobId ?? null,
      analysisId: result?.analysisId ?? null,
      hasResult: result !== null,
      resultSurveySubmitted: result?.surveySubmitted === true,
      recoveredSurvey: recoveredSurveyAnalysisId !== undefined,
      recoveredSurveyPending: recoveredSurveyPending === true,
      isRestoringResult,
      resultRestorationFailed,
      withdrawalCleanupStatus,
      sessionAdmission: sessionAdmission ?? null,
      surveyAnswerKeys: Object.keys(surveyAnswer),
    },
    browserResult: useStoredAnalysisPresence().analysisResult,
  }

  return (
    <DebugSnapshotPanel title="Home flow client snapshot" snapshot={snapshot} />
  )
}

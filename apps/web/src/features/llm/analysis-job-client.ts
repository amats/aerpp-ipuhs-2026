import type { AnalysisDocument } from "@/features/document/analysis-document-types"
import { awaitTabResponse, getTabOperationSignal } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"
import {
  analysisJobResultSchema,
  analysisJobStatusSchema,
  analysisNotStartedSchema,
} from "./analysis-job-types"

export async function requestAnalysisJob({
  documents,
  analysisId,
  signal,
}: {
  documents?: AnalysisDocument[]
  analysisId?: string
  signal: AbortSignal
}) {
  const sessionSignal = getTabOperationSignal()
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(
      documents ? limits.startRequestTimeoutMs : limits.requestTimeoutMs,
    ),
    ...(sessionSignal ? [sessionSignal] : []),
  ])
  const response = await fetch(
    analysisId
      ? `/api/llm/analysis/result?analysisId=${encodeURIComponent(analysisId)}`
      : "/api/llm/analysis",
    {
      method: documents ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "x-aerpp-tab": getTabToken() ?? "",
      },
      ...(documents ? { body: JSON.stringify({ documents }) } : {}),
      signal: requestSignal,
      cache: "no-store",
    },
  )
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error("解析の通信を確認できませんでした。")
  }
  const token = response.headers.get("x-aerpp-session-token")
  const adopted = await awaitTabResponse(
    Promise.resolve(
      body !== null && typeof body === "object"
        ? { ...body, ...(token ? { sessionToken: token } : {}) }
        : body,
    ),
    requestSignal,
  )
  if (documents) {
    const notStarted = analysisNotStartedSchema.safeParse(adopted)
    if (notStarted.success === true) return notStarted.data
  }
  if (response.ok !== true)
    throw new Error("解析の通信を確認できませんでした。")
  if (analysisId) {
    const result = analysisJobResultSchema.safeParse(adopted)
    if (result.success !== true || result.data.analysisId !== analysisId)
      throw new Error("解析結果の取得を確認できませんでした。")
    return result.data
  }
  const status = analysisJobStatusSchema.safeParse(adopted)
  if (status.success !== true)
    throw new Error("解析状態の取得を確認できませんでした。")
  return status.data
}

export function waitForAnalysisPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Cancelled", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, limits.pollIntervalMs)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

export async function acknowledgeAnalysisResult(analysisId: string) {
  const sessionSignal = getTabOperationSignal()
  const response = await fetch(
    `/api/llm/analysis/result?analysisId=${encodeURIComponent(analysisId)}`,
    {
      method: "DELETE",
      headers: { "x-aerpp-tab": getTabToken() ?? "" },
      signal: AbortSignal.any([
        AbortSignal.timeout(limits.requestTimeoutMs),
        ...(sessionSignal ? [sessionSignal] : []),
      ]),
      cache: "no-store",
    },
  )
  // A late cleanup response must not adopt a token or invalidate a newer screen.
  await response.body?.cancel()
  if (response.ok !== true) throw new Error("Analysis acknowledgement failed")
}

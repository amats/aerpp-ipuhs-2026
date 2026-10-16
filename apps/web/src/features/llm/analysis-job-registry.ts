import "server-only"

import { countGraphemes } from "@/lib/graphemes"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { isReceptionClosed } from "@/lib/reception"
import {
  type AuthorityRecord,
  sessionOperation,
  watchAuthority,
} from "@/lib/session-authority"
import { sessionStateSchema } from "@/lib/session-data"
import { APP_VERSION } from "@/lib/version"
import type { AnalysisAttempt } from "./analysis-attempt"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"
import type {
  AnalysisJobOwner,
  AnalysisJobResult,
  AnalysisJobStatus,
  AnalysisRetryInput,
} from "./analysis-job-types"
import { sealAnalysisCompletionReceipt } from "./analysis-receipt"
import { LLM_CONFIG } from "./analysis-server-config"
import { requestLlmResponse } from "./request-lm-studio-response"

type MemoryJob = {
  owner: AnalysisJobOwner
  observation: Omit<AnalysisJobStatus, "elapsedMs">
  result: AnalysisJobResult | null
  retryInput: AnalysisRetryInput | null
  controller: AbortController
  attempt?: AnalysisAttempt
  terminalOutcome?: "completed" | "failed" | "cancelled"
  ownership?: ReturnType<typeof watchAuthority>
  expiry: ReturnType<typeof setTimeout>
  deadline?: ReturnType<typeof setTimeout>
  retry?: Promise<boolean>
  execution?: Promise<void>
}

// One process owns inference and result memory. Route/action bundles in that
// process share this registry. No content is serialized to disk or cloud.
const runtime = globalThis as typeof globalThis & {
  __aerppAnalysisJobs?: Map<string, MemoryJob>
}
const jobs = runtime.__aerppAnalysisJobs ?? new Map<string, MemoryJob>()
runtime.__aerppAnalysisJobs = jobs

function matchesOwner(left: AnalysisJobOwner, right: AnalysisJobOwner) {
  return (
    left.sessionId === right.sessionId &&
    left.clientId === right.clientId &&
    left.pseudonym === right.pseudonym &&
    left.consentId === right.consentId
  )
}

function retainsAuthority(
  current: AuthorityRecord,
  owner: AnalysisJobOwner,
  analysisId: string,
) {
  if (
    current.withdrawing !== 0 ||
    isReceptionClosed() === true ||
    !current.state
  )
    return false
  try {
    const parsed = sessionStateSchema.safeParse(JSON.parse(current.state))
    if (parsed.success !== true) return false
    const state = parsed.data
    return (
      state.clientId === owner.clientId &&
      state.pseudonym === owner.pseudonym &&
      state.consentId === owner.consentId &&
      (state.activeAnalysisId === analysisId ||
        state.lastCompletedAnalysisId === analysisId)
    )
  } catch {
    return false
  }
}

function discard(analysisId: string, job: MemoryJob) {
  if (jobs.get(analysisId) !== job) return
  jobs.delete(analysisId)
  job.result = null
  job.retryInput = null
  clearTimeout(job.expiry)
  if (job.deadline) clearTimeout(job.deadline)
  job.ownership?.dispose()
  job.controller.abort()
}

function retainUntilAcknowledged(analysisId: string, job: MemoryJob) {
  clearTimeout(job.expiry)
  const expiresAtMs = Date.now() + limits.resultRetentionMs
  job.observation.expiresAtMs = expiresAtMs
  job.expiry = setTimeout(
    () => discard(analysisId, job),
    limits.resultRetentionMs,
  )
  job.expiry.unref()
}

export function reserveAnalysisJob({
  analysisId,
  owner,
  startedAtMs,
}: {
  analysisId: string
  owner: AnalysisJobOwner
  startedAtMs: number
}) {
  if (jobs.size >= limits.maxJobs || jobs.has(analysisId)) return null
  const analysisWorkspaceVersion = APP_VERSION
  const job: MemoryJob = {
    owner,
    observation: { ok: true, analysisId, status: "running", startedAtMs },
    result: null,
    retryInput: null,
    controller: new AbortController(),
    expiry: setTimeout(
      () => discard(analysisId, job),
      limits.maxDurationMs + limits.resultRetentionMs,
    ),
  }
  job.expiry.unref()
  jobs.set(analysisId, job)
  let started = false
  return {
    release() {
      discard(analysisId, job)
    },
    async terminate(attempt: AnalysisAttempt, logger: AppLogger) {
      if (started === true || jobs.get(analysisId) !== job) return
      started = true
      job.attempt = attempt
      job.terminalOutcome = "cancelled"
      // Admission has no content in this reservation. Keep its terminal request
      // retryable even when a local save failed after Support accepted the start.
      job.observation.status = "recording"
      job.execution = sessionOperation.exit(async () => {
        try {
          const recorded = await attempt.finish("cancelled")
          if (jobs.get(analysisId) === job)
            job.observation.status =
              recorded === true ? "cancelled" : "termination_pending"
        } catch (error) {
          logger.error({
            error,
            event: LOG_EVENT.analysisAttemptRecordFailed,
            analysisId,
          })
          if (jobs.get(analysisId) === job)
            job.observation.status = "termination_pending"
        } finally {
          if (jobs.get(analysisId) === job)
            retainUntilAcknowledged(analysisId, job)
        }
      })
      await job.execution
    },
    start({
      prompt,
      attempt,
      documentCount,
      documentGraphemeCount,
      documentGraphemeCounts,
      logger,
    }: {
      prompt: string
      attempt: AnalysisAttempt
      documentCount: number
      documentGraphemeCount: number
      documentGraphemeCounts: number[]
      logger: AppLogger
    }) {
      if (started === true || jobs.get(analysisId) !== job) return
      started = true
      job.attempt = attempt
      job.retryInput = {
        prompt,
        documentCount,
        documentGraphemeCount,
        documentGraphemeCounts,
      }
      job.ownership = watchAuthority(owner.sessionId, (current) =>
        retainsAuthority(current, owner, analysisId),
      )
      job.ownership.signal.addEventListener(
        "abort",
        () => discard(analysisId, job),
        { once: true },
      )
      if (job.ownership.signal.aborted) discard(analysisId, job)
      let timedOut = false
      job.deadline = setTimeout(
        () => {
          timedOut = true
          job.controller.abort()
        },
        Math.max(0, startedAtMs + limits.maxDurationMs - Date.now()),
      )
      job.deadline.unref()
      // Ordinary operation locks cover admission only. Detached inference never
      // inherits the request signal or holds the browser mutation fence.
      job.execution = sessionOperation
        .exit(async () => {
          try {
            job.controller.signal.throwIfAborted()
            const response = await requestLlmResponse({
              prompt,
              signal: job.controller.signal,
            })
            job.controller.signal.throwIfAborted()
            if (response.ok !== true) {
              job.observation.reason = response.reason
              throw new Error("LM Studio analysis failed")
            }
            // End the inference deadline before recording metadata. Recording can
            // be retried independently without another model request.
            if (job.deadline) clearTimeout(job.deadline)
            const receipt = await sealAnalysisCompletionReceipt({
              analysisId,
              analysisWorkspaceVersion,
              documentCount,
              documentGraphemeCount,
              modelName: LLM_CONFIG.model,
              ownerClientId: owner.clientId,
              ownerPseudonym: owner.pseudonym,
              processingDurationSeconds: Math.floor(
                (Date.now() - startedAtMs) / 1000,
              ),
              resultGraphemeCount: countGraphemes(response.text),
            })
            if (!receipt) throw new Error("Analysis receipt creation failed")
            job.controller.signal.throwIfAborted()
            // Preserve completed output before the external terminal record.
            job.retryInput = null
            job.result = { ok: true, analysisId, text: response.text, receipt }
            job.observation.status = "recording"
            retainUntilAcknowledged(analysisId, job)
            job.terminalOutcome = "completed"
            const recorded = await attempt.finish("completed")
            if (jobs.get(analysisId) !== job || job.controller.signal.aborted)
              return
            job.observation.status =
              recorded === true ? "ready" : "completion_pending"
            if (recorded !== true) job.observation.reason = "completion_failed"
            if (recorded === true)
              logger.debug({
                event: LOG_EVENT.llmAnalysisCompleted,
                analysisId,
                outcome: "completed",
              })
            else
              logger.warn({
                event: LOG_EVENT.llmAnalysisCompleted,
                analysisId,
                outcome: "partial",
              })
          } catch (error) {
            // A recording exception cannot turn completed inference into failure
            // or discard its output. The frozen terminal request remains retryable.
            if (job.terminalOutcome === "completed") {
              if (jobs.get(analysisId) === job)
                job.observation.status = "completion_pending"
              logger.error({
                error,
                event: LOG_EVENT.analysisAttemptRecordFailed,
                analysisId,
              })
              return
            }
            const outcome =
              job.controller.signal.aborted && timedOut !== true
                ? "cancelled"
                : "failed"
            if (timedOut === true) job.observation.reason = "timeout"
            else job.observation.reason ??= "llm_unavailable"
            job.terminalOutcome = outcome
            const recorded = await attempt.finish(outcome)
            if (jobs.get(analysisId) !== job) return
            job.result = null
            job.observation.status =
              recorded === true ? outcome : "termination_pending"
            retainUntilAcknowledged(analysisId, job)
            if (outcome === "cancelled") {
              if (recorded === true)
                logger.debug({
                  event: LOG_EVENT.llmAnalysisAborted,
                  analysisId,
                  outcome: "aborted",
                })
              else
                logger.warn({
                  event: LOG_EVENT.llmAnalysisAborted,
                  analysisId,
                  outcome: "partial",
                })
            } else
              logger.error({
                error,
                event: LOG_EVENT.llmAnalysisFailed,
                analysisId,
                outcome,
              })
          } finally {
            if (job.deadline) clearTimeout(job.deadline)
          }
        })
        .catch((error) => {
          // An unexpected recording failure must not leave a misleading running job.
          logger.error({
            error,
            event: LOG_EVENT.llmAnalysisFailed,
            analysisId,
            operation: "analysis_job",
          })
          if (jobs.get(analysisId) === job) {
            job.observation.status =
              job.terminalOutcome === "completed"
                ? "completion_pending"
                : job.terminalOutcome
                  ? "termination_pending"
                  : "unconfirmed"
            retainUntilAcknowledged(analysisId, job)
          }
        })
    },
  }
}

// Explicit cancellation stops inference, but retains ownership and the terminal
// request until Support and local coordination both acknowledge it. Revocation
// still discards content immediately through watchAuthority.
export async function cancelMemoryAnalysisJob(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  if (!job || matchesOwner(job.owner, owner) !== true) return
  if (job.terminalOutcome === undefined) job.controller.abort()
  await job.execution
}

export function readMemoryAnalysisJob(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  return job && matchesOwner(job.owner, owner) === true
    ? {
        ...job.observation,
        elapsedMs:
          job.observation.startedAtMs === null
            ? null
            : Math.max(0, Date.now() - job.observation.startedAtMs),
        canRetry:
          job.observation.status === "failed" && job.retryInput !== null,
      }
    : null
}

export function readMemoryAnalysisRetry(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  return job &&
    matchesOwner(job.owner, owner) === true &&
    job.observation.status === "failed"
    ? job.retryInput
    : null
}

export function readMemoryAnalysisResult(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  return job &&
    matchesOwner(job.owner, owner) === true &&
    job.observation.status === "ready"
    ? job.result
    : null
}

export async function retryMemoryAnalysisRecording(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  if (
    !job ||
    matchesOwner(job.owner, owner) !== true ||
    !job.attempt ||
    !job.terminalOutcome
  )
    return false
  if (["ready", "failed", "cancelled"].includes(job.observation.status))
    return true
  if (
    !["completion_pending", "termination_pending"].includes(
      job.observation.status,
    )
  )
    return false
  const outcome = job.terminalOutcome
  job.retry ??= job.attempt
    .retryFinish()
    .then((recorded) => {
      if (
        jobs.get(analysisId) !== job ||
        job.ownership?.signal.aborted === true
      )
        return false
      if (recorded === true) {
        job.observation.status = outcome === "completed" ? "ready" : outcome
        if (outcome === "completed") delete job.observation.reason
      }
      return recorded === true
    })
    .finally(() => {
      job.retry = undefined
    })
  return job.retry
}

export function acknowledgeMemoryAnalysisResult(
  analysisId: string,
  owner: AnalysisJobOwner,
) {
  const job = jobs.get(analysisId)
  if (!job) return true
  if (
    matchesOwner(job.owner, owner) !== true ||
    job.observation.status !== "ready"
  )
    return false
  discard(analysisId, job)
  return true
}

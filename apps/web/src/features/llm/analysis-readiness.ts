import "server-only"

import { isLocalLmStudioUrl } from "@aerpp/config/llm"
import { env } from "@aerpp/config/server/web"
import { z } from "zod"
import { analysisAuditStore } from "@/lib/analysis-audit-store"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  safeParseApiRequest,
  safeParseApiSuccess,
} from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"
import type { AppSession } from "@/lib/session"
import { LLM_CONFIG } from "./analysis-server-config"

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) })

async function modelAvailable(logger: AppLogger) {
  if (isLocalLmStudioUrl(LLM_CONFIG.baseUrl) !== true) return false
  const response = await fetchWithRetry(
    `${LLM_CONFIG.baseUrl.replace(/\/$/, "")}/models`,
    {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
    },
    {
      timeoutMs: 5_000,
      logging: { logger, dependency: "llm_readiness", target: "local_llm" },
    },
  )
  if (response.ok !== true || !response.body) {
    await response.body?.cancel()
    return false
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let text = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 64 * 1024) return false
      text += decoder.decode(chunk.value, { stream: true })
    }
    const parsed = modelsSchema.safeParse(JSON.parse(text + decoder.decode()))
    return (
      parsed.success === true &&
      parsed.data.data.some((model) => model.id === LLM_CONFIG.model)
    )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function supportAvailable(session: AppSession, logger: AppLogger) {
  const body = safeParseApiRequest("verifyAuthentication", {
    clientId: session.clientId,
    pseudonym: session.pseudonym,
    consentId: session.consentId,
    serverId: env.participantApiServerId,
  })
  if (body.success !== true) return false
  const response = await fetchWithRetry(
    env.verifyAuthenticationUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...participantApiHeaders(),
      },
      body: JSON.stringify(body.data),
    },
    {
      // Include headroom for Support cold starts before authentication responds.
      timeoutMs: 15_000,
      logging: {
        logger,
        dependency: "support_readiness",
        target: "participant_api",
      },
    },
  )
  const parsed = safeParseApiSuccess(
    "verifyAuthentication",
    await response.json(),
  )
  return response.status === 200 && parsed.success === true
}

// These read-only checks reject unavailable dependencies before reserving a
// study attempt. Admission still revalidates authorization transactionally:
// readiness is an observation, never a promise of future availability.
export async function checkAnalysisReadiness(
  session: AppSession,
  logger: AppLogger,
) {
  try {
    analysisAuditStore().assertWritable()
  } catch (error) {
    logger.error({ event: LOG_EVENT.analysisAuditQueueFailed, error })
    return {
      ok: false as const,
      reason: "analysis_storage_unavailable" as const,
    }
  }
  const checks = await Promise.allSettled([
    modelAvailable(logger),
    supportAvailable(session, logger),
  ])
  for (const [index, check] of checks.entries()) {
    if (check.status !== "fulfilled" || check.value !== true) {
      logger.warn({
        event: LOG_EVENT.dependencyRequestFailed,
        dependency: index === 0 ? "llm_readiness" : "support_readiness",
        operation: "analysis_readiness",
        outcome: "rejected",
      })
      return {
        ok: false as const,
        reason:
          index === 0
            ? ("analysis_model_unavailable" as const)
            : ("analysis_support_unavailable" as const),
      }
    }
  }
  return { ok: true as const }
}

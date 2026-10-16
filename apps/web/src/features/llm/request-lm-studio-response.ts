import "server-only"

import { isLocalLmStudioUrl } from "@aerpp/config/llm"
import { Agent, fetch as lmStudioFetch } from "undici"
import type { AnalysisDocument } from "@/features/document/analysis-document-types"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"
import { ANALYSIS_PROMPT, LLM_CONFIG } from "./analysis-server-config"
import { lmStudioResponseSchema } from "./lm-studio-response-types"

export function buildAnalysisUserPrompt(documents: AnalysisDocument[]): string {
  const normalized = documents
    .filter((document) => document.text.trim() !== "")
    .map(({ name, text }) => ({ name: name.trim(), text: text.trim() }))
    .sort((left, right) => {
      const leftKey = JSON.stringify(left)
      const rightKey = JSON.stringify(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  return `${ANALYSIS_PROMPT.header}${JSON.stringify(normalized, null, 2)}${ANALYSIS_PROMPT.footer}`
}

export async function requestLlmResponse({
  prompt,
  signal,
  fetchResponse = lmStudioFetch,
}: {
  prompt: string
  signal: AbortSignal
  fetchResponse?: typeof lmStudioFetch
}): Promise<
  | { ok: true; text: string }
  | { ok: false; reason: "llm_unavailable" | "invalid_response" }
> {
  if (isLocalLmStudioUrl(LLM_CONFIG.baseUrl) !== true || !LLM_CONFIG.model)
    return { ok: false, reason: "llm_unavailable" }
  const dispatcher = new Agent({
    headersTimeout: limits.maxDurationMs,
    bodyTimeout: limits.maxDurationMs,
    connections: 1,
  })
  try {
    const options: Parameters<typeof lmStudioFetch>[1] = {
      dispatcher,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: LLM_CONFIG.model,
        stream: false,
        store: false,
        instructions: ANALYSIS_PROMPT.system,
        input: prompt,
        temperature: LLM_CONFIG.generation.temperature,
        top_p: LLM_CONFIG.generation.topP,
        top_k: LLM_CONFIG.generation.topK,
        repeat_penalty: LLM_CONFIG.generation.repeatPenalty,
        seed: LLM_CONFIG.generation.seed,
      }),
      signal,
      cache: "no-store",
      redirect: "error",
    }
    const response = await fetchResponse(
      `${LLM_CONFIG.baseUrl.replace(/\/$/, "")}/responses`,
      options,
    )
    // Error bodies can echo documents. Never parse or log them.
    if (response.ok !== true) {
      await response.body?.cancel()
      return { ok: false, reason: "llm_unavailable" }
    }
    if (
      !response.body ||
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      await response.body?.cancel()
      return { ok: false, reason: "invalid_response" }
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let bytes = 0
    let body = ""
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) {
          body += decoder.decode()
          break
        }
        bytes += value.byteLength
        if (bytes > limits.maxResponseBytes)
          return { ok: false, reason: "invalid_response" }
        body += decoder.decode(value, { stream: true })
      }
      signal.throwIfAborted()
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        return { ok: false, reason: "invalid_response" }
      }
      const parsed = lmStudioResponseSchema.safeParse(json)
      if (parsed.success !== true)
        return { ok: false, reason: "invalid_response" }
      const messages = parsed.data.output.filter(
        (item) => item.type === "message",
      )
      if (
        messages.some(
          (item) =>
            item.role !== "assistant" ||
            (item.status !== undefined && item.status !== "completed"),
        )
      )
        return { ok: false, reason: "invalid_response" }
      const parts = messages.flatMap((item) => item.content ?? [])
      if (
        parts.some(
          (part) =>
            part.type !== "output_text" || typeof part.text !== "string",
        )
      )
        return { ok: false, reason: "invalid_response" }
      const text = parts.map((part) => part.text).join("")
      if (
        text.trim() === "" ||
        new TextEncoder().encode(text).byteLength > limits.maxResultBytes
      )
        return { ok: false, reason: "invalid_response" }
      return { ok: true, text }
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof TypeError && /encoded data/.test(error.message))
        return { ok: false, reason: "invalid_response" }
      // Preserve transport classification without leaking parser text.
      throw new Error("LM Studio response read failed")
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* Preserve the response outcome. */
      }
      reader.releaseLock()
    }
  } finally {
    await dispatcher.destroy()
  }
}

"use client"

import type { z } from "zod"
import { documentHistoryResultSchema } from "./document-history-types"
import { pdfDownloadResultSchema } from "./pdf-download-types"

async function requestDocument<T>(
  name: string,
  schema: z.ZodType<T>,
  token?: string,
  recordId?: string,
) {
  const query = new URLSearchParams({ name })
  if (recordId !== undefined) query.set("recordId", recordId)
  // Read-only downloads never enter the serialized Server Action dispatcher.
  // Late responses do not adopt session tokens; callers fence their own views.
  try {
    const response = await fetch(`/api/documents?${query}`, {
      headers: { "x-aerpp-tab": token ?? "" },
      cache: "no-store",
      // Cover history lookup, archived originals and PDF rendering together.
      signal: AbortSignal.timeout(name === "history" ? 20_000 : 90_000),
      redirect: "error",
    })
    if (response.ok !== true) throw new Error("Document request failed")
    return schema.parse(await response.json())
  } catch {
    throw new Error(
      "書類を取得できませんでした。通信状態を確認し、時間をおいて再試行してください。",
    )
  }
}

export async function requestExplanationPdf(token?: string) {
  return requestDocument("explanation", pdfDownloadResultSchema, token)
}
export async function requestPlanPdf(token?: string) {
  return requestDocument("plan", pdfDownloadResultSchema, token)
}
export async function requestConsentPdf(token?: string) {
  return requestDocument("consent", pdfDownloadResultSchema, token)
}
export async function requestWithdrawalPdf(token?: string) {
  return requestDocument("withdrawal", pdfDownloadResultSchema, token)
}
export async function requestHistoricalDocument(
  recordId: string,
  name: string,
  token?: string,
) {
  return requestDocument(name, pdfDownloadResultSchema, token, recordId)
}
export async function requestDocumentHistory(token?: string) {
  return requestDocument("history", documentHistoryResultSchema, token)
}

import "server-only"

import { createRequestLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { REQUEST_ID_HEADER } from "@/lib/request-id"
import {
  listDocumentHistory,
  loadHistoricalDocument,
} from "./document-history-service"
import {
  loadConsentPdf,
  loadExplanationPdf,
  loadPlanPdf,
  loadWithdrawalPdf,
} from "./pdf-download-service"
import { documentRequestSchema } from "./pdf-download-types"

export async function handleDocumentRead(request: Request) {
  const { logger, requestId } = createRequestLogger(request, {
    component: "pdf",
    operation: "document_read",
  })
  const headers = {
    "Cache-Control": "private, no-store",
    [REQUEST_ID_HEADER]: requestId,
  }
  const failure = {
    ok: false as const,
    error: "書類を取得できませんでした。時間をおいて再試行してください。",
    reason: "document_history_unavailable",
  }
  const query = new URL(request.url).searchParams
  const input = documentRequestSchema.safeParse(Object.fromEntries(query))
  if (
    input.success !== true ||
    [...query.keys()].some((key) => query.getAll(key).length !== 1)
  )
    return Response.json(failure, { status: 400, headers })
  const token = request.headers.get("x-aerpp-tab") ?? undefined
  try {
    const { name, recordId } = input.data
    const loaders = {
      explanation: loadExplanationPdf,
      plan: loadPlanPdf,
      consent: loadConsentPdf,
      withdrawal: loadWithdrawalPdf,
    }
    const result =
      name === "history"
        ? await listDocumentHistory(token)
        : recordId !== undefined
          ? await loadHistoricalDocument(recordId, name, token)
          : await loaders[name](token)
    return Response.json(result, { headers })
  } catch (error) {
    logger.error({ event: LOG_EVENT.pdfHistoryFailed, error })
    return Response.json(failure, { status: 503, headers })
  }
}

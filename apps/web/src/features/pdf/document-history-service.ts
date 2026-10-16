import "server-only"

import { renderDocumentPdf } from "@aerpp/documents/pdf"
import { z } from "zod"
import { Stage } from "@/features/app-context/stage-types"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import { listParticipationEvents } from "@/features/auth/auth-service"
import { readEmailFromSession } from "@/features/auth/email"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import { withSessionRead } from "@/features/session/session-operation"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { getSession } from "@/lib/session"
import { buildDocumentHistory } from "./build-document-history"
import { generateRecordedParticipantPdf } from "./generate-pdf"
import type { PdfDownloadResult } from "./pdf-download-types"
import { readPdfFont, readRecordedPdfTemplate } from "./pdf-templates"

async function readOwnHistory() {
  const session = await getSession()
  const stage = readStageFromSession(session)
  if (
    [Stage.authenticated, Stage.followUp, Stage.withdrawn].some(
      (allowed) => allowed === stage,
    ) !== true ||
    !session.consentId
  )
    throw new Error("Document session required")
  const email = await readEmailFromSession(session)
  const pseudonym = email ? createPseudonym(email) : null
  if (!pseudonym || pseudonym !== session.pseudonym)
    throw new Error("Document owner required")
  const records = await listParticipationEvents(pseudonym, {
    requireComplete: true,
  })
  if (
    records.some(
      (record) =>
        record.eventType === "consent" &&
        (record.consentId ?? record.id) === session.consentId &&
        record.pseudonym === pseudonym,
    ) !== true
  )
    throw new Error("Document consent evidence required")
  return {
    records: records.filter((record) => record.pseudonym === pseudonym),
    currentConsentId: session.consentId,
  }
}
export async function listDocumentHistory(token?: string) {
  try {
    return await withSessionRead(
      token,
      async () => {
        const { records, currentConsentId } = await readOwnHistory()
        return {
          ok: true as const,
          history: buildDocumentHistory(records, currentConsentId),
        }
      },
      { allowAcceptedWithdrawal: true },
    )
  } catch (error) {
    createLogger({ component: "pdf", operation: "history" }).error({
      error,
      event: LOG_EVENT.pdfHistoryFailed,
    })
    return { ok: false as const, reason: "document_history_unavailable" }
  }
}
export async function loadHistoricalDocument(
  recordId: string,
  name: string,
  token?: string,
): Promise<PdfDownloadResult> {
  try {
    const result = await withSessionRead(
      token,
      async () => {
        const input = z
          .object({
            recordId: z.string().min(1).max(256),
            name: z.enum(["consent", "withdrawal", "explanation", "plan"]),
          })
          .parse({ recordId, name })
        const record = (await readOwnHistory()).records.find(
          (record) => record.id === input.recordId,
        )
        if (
          !record ||
          ((input.name === "consent" || input.name === "withdrawal") &&
            record.eventType !== input.name)
        )
          throw new Error("Document record not found")
        const bytes =
          input.name === "consent" || input.name === "withdrawal"
            ? (await generateRecordedParticipantPdf(record)).pdfBytes
            : await renderDocumentPdf(
                await readRecordedPdfTemplate(input.name, record),
                await readPdfFont(),
                record.documentSet,
              )
        return {
          ok: true as const,
          contentBase64: Buffer.from(bytes).toString("base64"),
          filename: `AERPP-${input.name}-${record.id}.pdf`,
        }
      },
      { allowAcceptedWithdrawal: true },
    )
    return result.ok === true
      ? result
      : {
          ok: false,
          error:
            "書類を取得できませんでした。画面を再読み込みして再試行してください。",
        }
  } catch (error) {
    createLogger({ component: "pdf", operation: "historical_download" }).error({
      error,
      event: LOG_EVENT.pdfHistoryFailed,
    })
    return {
      ok: false,
      error: "書類を取得できませんでした。時間をおいて再試行してください。",
    }
  }
}

import "server-only"

import { headers } from "next/headers"
import { Stage } from "@/features/app-context/stage-types"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import { readEmailFromSession } from "@/features/auth/email"
import {
  generateConsentPdf,
  generateWithdrawalPdf,
} from "@/features/pdf/generate-pdf"
import { readExplanationPdf, readPlanPdf } from "@/features/pdf/read-pdf"
import { readWithdrawalRequestFromSession } from "@/features/withdraw/withdrawal-session"
import {
  createLogger,
  getRequestContextFromHeaders,
  logRouteRejected,
} from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { getSessionForTab } from "@/lib/session"

import type { PdfDownloadResult } from "./pdf-download-types"

async function createPdfLogger(operation: string) {
  const headerStore = await headers()
  return createLogger({
    ...getRequestContextFromHeaders(headerStore),
    component: "pdf",
    operation,
  })
}

export async function loadExplanationPdf(): Promise<PdfDownloadResult> {
  const logger = await createPdfLogger("explanation")

  try {
    const pdfBytes = await readExplanationPdf()
    return {
      ok: true,
      contentBase64: Buffer.from(pdfBytes).toString("base64"),
      filename: "AERPP-Explanation.pdf",
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.pdfExplanationFailed,
    })
    return {
      ok: false,
      error:
        "説明文書のダウンロードに失敗しました。時間をおいて再度お試しください。",
    }
  }
}

export async function loadPlanPdf(token?: string): Promise<PdfDownloadResult> {
  const logger = await createPdfLogger("plan")
  try {
    const session = await getSessionForTab(token)
    const stage = readStageFromSession(session)

    if (
      stage !== Stage.authenticated &&
      stage !== Stage.withdrawn &&
      stage !== Stage.followUp
    ) {
      logRouteRejected(logger, 400, { stage })
      return {
        ok: false,
        error:
          "研究計画書をダウンロードできる状態ではありません。画面の案内を確認してから再度お試しください。",
      }
    }

    const pdfBytes = await readPlanPdf()
    return {
      ok: true,
      contentBase64: Buffer.from(pdfBytes).toString("base64"),
      filename: "AERPP-Plan.pdf",
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.pdfPlanFailed,
    })
    return {
      ok: false,
      error:
        "研究計画書のダウンロードに失敗しました。時間をおいて再度お試しください。",
    }
  }
}

export async function loadConsentPdf(
  token?: string,
): Promise<PdfDownloadResult> {
  const logger = await createPdfLogger("consent")
  try {
    const session = await getSessionForTab(token)
    const stage = readStageFromSession(session)

    if (
      stage !== Stage.authenticated &&
      stage !== Stage.withdrawn &&
      stage !== Stage.followUp
    ) {
      logRouteRejected(logger, 400, { stage })
      return {
        ok: false,
        error:
          "同意書をダウンロードできる状態ではありません。画面の案内を確認してから再度お試しください。",
      }
    }

    const email = await readEmailFromSession(session)
    if (!email || !session.consentId) {
      logRouteRejected(logger, 400, {
        operation: "participant_identity_missing",
      })
      return {
        ok: false,
        error:
          "同意書のダウンロードに必要な情報を確認できませんでした。時間をおいて再度お試しください。",
      }
    }

    const { documentId, pdfBytes } = await generateConsentPdf(
      email,
      session.consentId,
    )
    logger.debug({
      documentId,
      event: LOG_EVENT.pdfConsentGenerated,
      outcome: "succeeded",
    })
    return {
      ok: true,
      contentBase64: Buffer.from(pdfBytes).toString("base64"),
      filename: "AERPP-Consent.pdf",
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.pdfConsentFailed,
    })
    return {
      ok: false,
      error:
        "同意書のダウンロードに失敗しました。時間をおいて再度お試しください。",
    }
  }
}

export async function loadWithdrawalPdf(
  token?: string,
): Promise<PdfDownloadResult> {
  const logger = await createPdfLogger("withdrawal")
  try {
    const session = await getSessionForTab(token)
    const stage = readStageFromSession(session)

    const withdrawalRequest = readWithdrawalRequestFromSession(session)
    // An accepted withdrawal can outlive a failed local stage write. The PDF
    // generator still requires the matching durable withdrawal record.
    const hasSavedWithdrawalRequest =
      (stage === Stage.authenticated || stage === Stage.followUp) &&
      withdrawalRequest?.consentId === session.consentId &&
      withdrawalRequest !== null
    if (stage !== Stage.withdrawn && !hasSavedWithdrawalRequest) {
      logRouteRejected(logger, 400, { stage })
      return {
        ok: false,
        error:
          "同意撤回書をダウンロードできる状態ではありません。画面の案内を確認してから再度お試しください。",
      }
    }

    const email = await readEmailFromSession(session)
    if (!email || !session.consentId) {
      logRouteRejected(logger, 400, {
        operation: "participant_identity_missing",
      })
      return {
        ok: false,
        error:
          "同意撤回書のダウンロードに必要な情報を確認できませんでした。時間をおいて再度お試しください。",
      }
    }

    const { documentId, pdfBytes } = await generateWithdrawalPdf(
      email,
      session.consentId,
    )
    logger.debug({
      documentId,
      event: LOG_EVENT.pdfWithdrawalGenerated,
      outcome: "succeeded",
    })
    return {
      ok: true,
      contentBase64: Buffer.from(pdfBytes).toString("base64"),
      filename: "AERPP-Withdrawal.pdf",
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.pdfWithdrawalFailed,
    })
    return {
      ok: false,
      error:
        "同意撤回書のダウンロードに失敗しました。時間をおいて再度お試しください。",
    }
  }
}

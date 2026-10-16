"use client"

import saveAs from "file-saver"
import type { PdfDownloadResult } from "@/features/pdf/pdf-download-types"
import { isBrowserSessionCurrent } from "@/lib/browser-session"
import { readTabGeneration } from "@/lib/session-generation"
import { awaitTabResponse, isTabOperationCurrent } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"

export async function downloadPdf(
  loadPdf: (token?: string) => Promise<PdfDownloadResult>,
  options: {
    ordinaryOperation?: boolean
  } = {},
): Promise<void> {
  const scope = readTabGeneration(getTabToken())
  let result: PdfDownloadResult
  if (options.ordinaryOperation === true) {
    if (isTabOperationCurrent() !== true) return
    try {
      result = await awaitTabResponse(loadPdf(getTabToken()))
    } catch (error) {
      if (isTabOperationCurrent() !== true) return
      throw error
    }
    if (isTabOperationCurrent() !== true) return
  } else {
    result = await loadPdf(getTabToken())
  }

  if (scope && isBrowserSessionCurrent(scope) !== true) return
  if (result.ok !== true) {
    throw new Error(result.error)
  }

  const binary = window.atob(result.contentBase64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

  saveAs(new Blob([bytes], { type: "application/pdf" }), result.filename)
}

/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  activateTabOperations,
  cancelTabOperations,
} from "@/lib/tab-cancellation"
import type { PdfDownloadResult } from "./pdf-download-types"

const saveAsMock = vi.fn()
const isBrowserSessionCurrentMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/browser-session", () => ({
  readBrowserRecoveryRevision: () => 0,
  isBrowserSessionCurrent: isBrowserSessionCurrentMock,
}))

vi.mock("@/lib/tab-token", () => ({
  getTabToken: () => `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:${"b".repeat(64)}`,
}))

vi.mock("file-saver", () => ({
  default: saveAsMock,
}))

describe("downloadPdf", () => {
  beforeEach(() => {
    saveAsMock.mockReset()
    isBrowserSessionCurrentMock.mockReturnValue(true)
  })

  it("downloads the blob returned by the document read", async () => {
    const { downloadPdf } = await import("./download-pdf")

    await downloadPdf(async () => ({
      ok: true,
      contentBase64: "cGRm",
      filename: "server-name.pdf",
    }))
    expect(saveAsMock).toHaveBeenCalledWith(expect.any(Blob), "server-name.pdf")
  })

  it("throws the action error when the download cannot be prepared", async () => {
    const { downloadPdf } = await import("./download-pdf")
    await expect(
      downloadPdf(async () => ({
        ok: false,
        error: "PDFの準備に失敗しました。",
      })),
    ).rejects.toThrow("PDFの準備に失敗しました。")
    expect(saveAsMock).not.toHaveBeenCalled()
  })

  it.each([null, undefined, "false", 1, {}, []])(
    "does not save a PDF without actual boolean success: %j",
    async (ok) => {
      const { downloadPdf } = await import("./download-pdf")
      await expect(
        downloadPdf(
          async () =>
            ({
              ok,
              error: "PDFの準備を確認できませんでした。",
              contentBase64: "cGRm",
              filename: "unconfirmed.pdf",
            }) as unknown as PdfDownloadResult,
        ),
      ).rejects.toThrow("PDFの準備を確認できませんでした。")
      expect(saveAsMock).not.toHaveBeenCalled()
    },
  )

  it.each([false, null, undefined, "false", 1, {}, []])(
    "does not save a late PDF without confirmed current-session authority: %j",
    async (current) => {
      const { downloadPdf } = await import("./download-pdf")
      const response = Promise.withResolvers<PdfDownloadResult>()
      const downloading = downloadPdf(() => response.promise)
      isBrowserSessionCurrentMock.mockReturnValue(current)
      response.resolve({ ok: true, contentBase64: "cGRm", filename: "old.pdf" })
      await downloading
      expect(saveAsMock).not.toHaveBeenCalled()
    },
  )

  it("cancels an automatic download on takeover and ignores its late PDF", async () => {
    const { downloadPdf } = await import("./download-pdf")
    localStorage.clear()
    activateTabOperations("original")
    const response = Promise.withResolvers<PdfDownloadResult>()
    const waiting = downloadPdf(() => response.promise, {
      ordinaryOperation: true,
    })
    cancelTabOperations()
    await waiting
    response.resolve({ ok: true, contentBase64: "cGRm", filename: "stale.pdf" })
    await Promise.resolve()
    expect(saveAsMock).not.toHaveBeenCalled()
    // Explicit downloads remain available from otherwise blocked tabs.
    await downloadPdf(async () => ({
      ok: true,
      contentBase64: "cGRm",
      filename: "requested.pdf",
    }))
    expect(saveAsMock).toHaveBeenCalledWith(expect.any(Blob), "requested.pdf")
  })
})

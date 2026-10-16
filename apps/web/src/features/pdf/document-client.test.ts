import { afterEach, describe, expect, it, vi } from "vitest"
import {
  requestConsentPdf,
  requestDocumentHistory,
  requestHistoricalDocument,
  requestWithdrawalPdf,
} from "./document-client"

const pdf = { ok: true, contentBase64: "AQID", filename: "receipt.pdf" }
afterEach(() => vi.unstubAllGlobals())

describe("document read transport", () => {
  it("reads documents independently while another download is pending", async () => {
    let release!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          release = resolve
        }),
      )
      .mockResolvedValueOnce(Response.json(pdf))
    vi.stubGlobal("fetch", fetchMock)
    const pending = requestConsentPdf("first-tab")
    await expect(requestWithdrawalPdf("second-tab")).resolves.toEqual(pdf)
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/documents?name=withdrawal",
      expect.objectContaining({
        headers: { "x-aerpp-tab": "second-tab" },
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    ])
    release(Response.json(pdf))
    await expect(pending).resolves.toEqual(pdf)
  })

  it("encodes exact owned record selection and keeps credentials out of the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(pdf))
    vi.stubGlobal("fetch", fetchMock)
    await requestHistoricalDocument(
      "record/a?b",
      "consent",
      "private-tab-context",
    )
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/documents?name=consent&recordId=record%2Fa%3Fb",
    )
  })

  it.each([false, null, undefined, "true", "false", 1, {}, []])(
    "rejects malformed download success: %j",
    async (ok) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ...pdf, ok })),
      )
      await expect(requestConsentPdf()).rejects.toThrow()
    },
  )

  it("rejects an unsuccessful HTTP response even when its body claims success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(pdf, { status: 503 })),
    )
    await expect(requestConsentPdf()).rejects.toThrow(
      "書類を取得できませんでした",
    )
  })

  it("preserves structured stale-session failures without adopting a token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ok: false,
          reason: "stale_session_state",
          tabToken: "obsolete-token",
        }),
      ),
    )
    await expect(requestDocumentHistory("current-token")).resolves.toEqual({
      ok: false,
      reason: "stale_session_state",
    })
  })
})

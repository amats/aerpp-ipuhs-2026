/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

const { reissue } = vi.hoisted(() => ({ reissue: vi.fn() }))
vi.mock("./actions-document-reissue", () => ({
  reissueParticipantDocumentAction: reissue,
}))

import DocumentReissueForm from "./document-reissue-form"

it("downloads the requested participant's PDF even after another participant is selected", async () => {
  const response = Promise.withResolvers<unknown>()
  reissue.mockReturnValueOnce(response.promise)
  vi.useFakeTimers()
  const createUrl = vi.fn(() => "blob:synthetic")
  const revokeUrl = vi.fn()
  vi.stubGlobal("URL", {
    createObjectURL: createUrl,
    revokeObjectURL: revokeUrl,
  })
  let downloadedFilename: string | undefined
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })
  const container = document.createElement("div")
  const root = createRoot(container)
  const records = [
    { id: "consent-A", eventType: "consent", time: 1000, fields: [] },
  ]
  try {
    await act(async () =>
      root.render(
        <DocumentReissueForm
          key="A"
          pseudonym="participant-A"
          records={records}
        />,
      ),
    )
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    )
    await act(async () =>
      root.render(
        <DocumentReissueForm
          key="B"
          pseudonym="participant-B"
          records={[{ ...records[0], id: "consent-B" }]}
        />,
      ),
    )
    await act(async () =>
      response.resolve({
        ok: true,
        contentBase64: btoa("synthetic-PDF-A"),
        filename: "participant-A.pdf",
      }),
    )
    expect(reissue).toHaveBeenCalledExactlyOnceWith({
      pseudonym: "participant-A",
      recordId: "consent-A",
      name: "receipt",
    })
    expect(click).toHaveBeenCalledOnce()
    expect(downloadedFilename).toBe("participant-A.pdf")
    expect(createUrl).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain("書類を生成しました")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:synthetic")
  } finally {
    await act(async () => root.unmount())
    click.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import type {
  DocumentHistoryRecord,
  DocumentHistory as History,
} from "@/features/pdf/document-history-types"

const mocks = vi.hoisted(() => ({
  session: { status: "ready", cleanup: "pending", canRetry: false },
  retryAdmission: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  current: vi.fn(),
}))
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({
    sessionAdmission: mocks.session.status,
    canRetrySessionAdmission: mocks.session.canRetry,
    retrySessionAdmission: mocks.retryAdmission,
    withdrawalCleanupStatus: mocks.session.cleanup,
  }),
}))
vi.mock("@/features/pdf/document-client", () => ({
  requestDocumentHistory: mocks.list,
  requestHistoricalDocument: mocks.download,
}))
vi.mock("@/features/pdf/download-pdf", () => ({
  downloadPdf: (loadPdf: (token: string) => Promise<unknown>) =>
    loadPdf("selected-session"),
}))
vi.mock("@/lib/tab-token", () => ({ getTabToken: () => "selected-session" }))
vi.mock("@/lib/session-generation", () => ({
  readTabGeneration: () => ({ generationId: "original" }),
}))
vi.mock("@/lib/browser-session", () => ({
  readBrowserRecoveryRevision: () => 0,
  isBrowserSessionCurrent: mocks.current,
}))

import DocumentHistory from "./document-history"

const currentSet = { version: "2.0", sha256: "b".repeat(64) }
function record(
  id: string,
  eventType: "consent" | "withdrawal" = "consent",
  documentSet = currentSet,
): DocumentHistoryRecord {
  return { id, eventType, date: "2026-09-15T16:00:00.000Z", documentSet }
}
function history(withdrawal: DocumentHistoryRecord | null = null): History {
  return {
    current: { consent: record("current-consent"), withdrawal },
    previous: [],
  }
}
async function renderHistory() {
  const container = document.createElement("div")
  const root = createRoot(container)
  const render = () => root.render(<DocumentHistory currentSet={currentSet} />)
  await act(async () => render())
  return { container, root, render }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.current.mockReturnValue(true)
  mocks.session.status = "ready"
  mocks.session.canRetry = false
  mocks.session.cleanup = "pending"
  mocks.list.mockResolvedValue({ ok: true, history: history() })
})

it("waits for admission and replaces invalidated history with explicit reload and input-loss guidance", async () => {
  mocks.session.status = "checking"
  const { container, render } = await renderHistory()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(container.textContent).toContain("利用状態を確認しています")
  mocks.session.status = "ready"
  await act(async () => render())
  expect(mocks.list).toHaveBeenCalledWith("selected-session")
  expect(
    container.querySelector(
      'button[aria-label="同意書の控え：PDFをダウンロード"]',
    ),
  ).not.toBeNull()
  mocks.session.status = "unavailable"
  await act(async () => render())
  expect(container.querySelectorAll("button")).toHaveLength(1)
  expect(container.querySelector("button")?.textContent).toBe(
    "ページを再読み込み",
  )
  expect(container.textContent).toContain("セッションを確認できません")
  expect(container.textContent).toContain("未送信の回答")
  expect(container.textContent).not.toContain("利用状態を確認しています")
  expect(mocks.list).toHaveBeenCalledTimes(1)
  expect(mocks.retryAdmission).not.toHaveBeenCalled()
})

it("offers admission retry after a transient failure without reading history or requiring reload", async () => {
  mocks.session.status = "unavailable"
  mocks.session.canRetry = true
  const { container, render } = await renderHistory()
  expect(container.textContent).toContain("セッションを確認できませんでした")
  expect(container.textContent).not.toContain("再読み込み")
  expect(mocks.list).not.toHaveBeenCalled()
  const retry = container.querySelector("button") as HTMLButtonElement
  expect(retry.textContent).toBe("セッションの確認を再試行")
  await act(async () => retry.click())
  expect(mocks.retryAdmission).toHaveBeenCalledTimes(1)
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.download).not.toHaveBeenCalled()
  mocks.session.status = "ready"
  await act(async () => render())
  expect(mocks.list).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain("同意成立")
})

it.each([
  [currentSet, "同意時と現在公開中の書類の版は同じです。"],
  [
    { version: "1.0", sha256: "a".repeat(64) },
    "同意時と現在公開中の書類の版は異なります。現在公開中：v2.0",
  ],
  [
    { version: "2.0", sha256: "a".repeat(64) },
    "版番号は同じですが、文書セットは異なります。",
  ],
])(
  "compares document identity and displays Japan confirmation dates (%j)",
  async (documentSet, message) => {
    const data = history()
    data.current.consent.documentSet = documentSet
    mocks.list.mockResolvedValue({ ok: true, history: data })
    const { container } = await renderHistory()
    expect(container.textContent).toContain(message)
    expect(container.textContent).toContain("2026年9月16日 01:00（日本時間）")
    expect(container.textContent).not.toContain("これまでの同意・撤回")
    expect(
      container.querySelector('a[href="#current-documents"]') !== null,
    ).toBe(documentSet.sha256 !== currentSet.sha256)
  },
)

it.each(["unconfirmed", "pending", "stateFailed", "localFailed", "complete"])(
  "offers a record-bound withdrawal receipt independently of cleanup: %s",
  async (cleanup) => {
    mocks.session.cleanup = cleanup
    mocks.list.mockResolvedValue({
      ok: true,
      history: history(record("withdrawal", "withdrawal")),
    })
    const { container } = await renderHistory()
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="同意撤回書の控え：PDFをダウンロード"]',
    ) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(mocks.download).toHaveBeenCalledWith(
      "withdrawal",
      "withdrawal",
      "selected-session",
    )
    expect(container.textContent).toContain(
      "データの消去完了を証明するものではありません",
    )
    expect(container.querySelector('a[href="/withdraw"]') !== null).toBe(
      cleanup !== "complete",
    )
  },
)

it("keeps older periods collapsed, their exact event selection, and separate withdrawal versions", async () => {
  const data = history()
  data.previous = [
    {
      consent: record("old-consent", "consent", {
        version: "1.0",
        sha256: "a".repeat(64),
      }),
      withdrawal: record("old-withdrawal", "withdrawal", {
        version: "1.5",
        sha256: "c".repeat(64),
      }),
    },
  ]
  mocks.list.mockResolvedValue({ ok: true, history: data })
  const { container } = await renderHistory()
  const details = container.querySelector("details") as HTMLDetailsElement
  expect(details.open).toBe(false)
  expect(details.querySelector("summary")?.textContent).toContain("v1.0")
  expect(details.querySelector("summary")?.textContent).toContain("v1.5")
  const buttons = details.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="同意時の説明文書：PDFをダウンロード"], button[aria-label="撤回時の研究計画書：PDFをダウンロード"]',
  )
  await act(async () => buttons[0].click())
  expect(mocks.download).toHaveBeenLastCalledWith(
    "old-consent",
    "explanation",
    "selected-session",
  )
  await act(async () => buttons[1].click())
  expect(mocks.download).toHaveBeenLastCalledWith(
    "old-withdrawal",
    "plan",
    "selected-session",
  )
  expect(details.querySelector('a[href="/withdraw"]')).toBeNull()
})

it("distinguishes loading and failure from no history and retries the read only", async () => {
  const response = Promise.withResolvers<unknown>()
  mocks.list.mockReturnValueOnce(response.promise)
  const { container } = await renderHistory()
  expect(container.textContent).toContain("同意履歴を確認しています")
  await act(async () =>
    response.resolve({ ok: false, reason: "document_history_unavailable" }),
  )
  expect(container.textContent).toContain("同意履歴を取得できませんでした")
  expect(container.textContent).not.toContain("履歴がありません")
  await act(async () =>
    (container.querySelector("button") as HTMLButtonElement).click(),
  )
  expect(mocks.list).toHaveBeenCalledTimes(2)
  expect(
    container.querySelector(
      'button[aria-label="同意書の控え：PDFをダウンロード"]',
    ),
  ).not.toBeNull()
  expect(mocks.download).not.toHaveBeenCalled()
})

it("offers reload for a stale session rather than repeatedly reading with a stale token", async () => {
  mocks.list.mockResolvedValue({ ok: false, reason: "stale_session_state" })
  const { container } = await renderHistory()
  expect(container.textContent).toContain("利用状態が変わりました")
  expect(container.querySelector("button")?.textContent).toBe(
    "ページを再読み込み",
  )
  expect(container.textContent).toContain("未送信の回答")
})

it.each(["unmount", "replacement", "admission"])(
  "does not adopt a late history response after %s",
  async (change) => {
    const response = Promise.withResolvers<unknown>()
    mocks.list.mockReturnValueOnce(response.promise)
    const { container, root, render } = await renderHistory()
    if (change === "unmount")
      await act(async () => root.render(<p>次の画面</p>))
    if (change === "replacement") mocks.current.mockReturnValue(false)
    if (change === "admission") {
      mocks.session.status = "unavailable"
      await act(async () => render())
    }
    await act(async () => response.resolve({ ok: true, history: history() }))
    expect(
      container.querySelector(
        'button[aria-label="同意書の控え：PDFをダウンロード"]',
      ),
    ).toBeNull()
  },
)

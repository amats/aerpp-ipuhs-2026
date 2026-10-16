/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import StepProgress from "@/features/home-flow/step-progress"
import type { InformationMessage } from "./actions-message"
import InformationMessageList from "./information-message-list"
import {
  MessageContextProvider,
  useMessageContext,
} from "./message-context-provider"

const { getMessagesMock } = vi.hoisted(() => ({ getMessagesMock: vi.fn() }))
vi.mock("./actions-message", () => ({
  getInformationMessagesAction: getMessagesMock,
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({
    rootStep: "start",
    stage: "unauthenticated",
  }),
}))

const messages: InformationMessage[] = [
  { id: "notice-1", content: "First notice", tone: "info" },
  { id: "notice-2", content: "Second notice", tone: "warning" },
]
let container: HTMLDivElement
let root: Root
let context: ReturnType<typeof useMessageContext>
function Probe() {
  context = useMessageContext()
  return <InformationMessageList />
}
async function renderList(showProgress = false) {
  await act(async () =>
    root.render(
      <MessageContextProvider>
        <Probe />
        {showProgress && <StepProgress />}
      </MessageContextProvider>,
    ),
  )
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  getMessagesMock.mockReset().mockResolvedValue(messages)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

it("does not reshow a notice dismissed while the first fetch is pending", async () => {
  let finish!: (value: InformationMessage[]) => void
  getMessagesMock.mockReturnValueOnce(
    new Promise<InformationMessage[]>((resolve) => {
      finish = resolve
    }),
  )
  await renderList()
  await act(async () => {
    await context.dismissInformationMessage("notice-1")
  })
  await act(async () => finish(messages))
  expect(container.textContent).not.toContain("First notice")
  expect(container.textContent).toContain("Second notice")
})

it("retains dismissed IDs when information retrieval is unavailable", async () => {
  window.localStorage.setItem(
    "aerpp:dismissed-information-message-ids",
    '["notice-1"]',
  )
  getMessagesMock.mockResolvedValue(null)
  await renderList()
  expect(context.dismissedInformationMessageIds).toEqual(["notice-1"])
  expect(
    window.localStorage.getItem("aerpp:dismissed-information-message-ids"),
  ).toBe('["notice-1"]')
  expect(container.textContent).toBe("")
})

it("removes obsolete dismissed IDs only after a successful response", async () => {
  window.localStorage.setItem(
    "aerpp:dismissed-information-message-ids",
    '["obsolete","notice-1"]',
  )
  await renderList()
  expect(context.dismissedInformationMessageIds).toEqual(["notice-1"])
  expect(container.textContent).not.toContain("First notice")
  expect(container.textContent).toContain("Second notice")
})

it("contains action transport failures without changing dismissed IDs", async () => {
  window.localStorage.setItem(
    "aerpp:dismissed-information-message-ids",
    '["notice-1"]',
  )
  getMessagesMock.mockRejectedValue(new Error("offline"))
  await renderList()
  expect(context.dismissedInformationMessageIds).toEqual(["notice-1"])
  expect(container.textContent).toBe("")
})

it("keeps dismissal usable when saving the display preference fails", async () => {
  await renderList()
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError")
  })
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  )
  expect(container.textContent).not.toContain("First notice")
  expect(container.textContent).toContain("Second notice")
})

it("reshows dismissed notices even when saving the reset preference fails", async () => {
  window.localStorage.setItem(
    "aerpp:dismissed-information-message-ids",
    '["notice-1"]',
  )
  await renderList(true)
  expect(container.textContent).not.toContain("First notice")
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError")
  })
  const reshowButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "メッセージを再表示",
  )
  expect(reshowButton).toBeDefined()
  await act(async () => reshowButton?.click())
  expect(container.textContent).toContain("First notice")
  expect(context.dismissedInformationMessageIds).toEqual([])
})

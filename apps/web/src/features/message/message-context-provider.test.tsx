/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let pathname = "/"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

describe("MessageContextProvider", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    pathname = "/"
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
  })

  it.each(["late failure", null])(
    "ignores a departed route's status update (%s), including after returning to that path",
    async (message) => {
      const { MessageContextProvider, useMessageContext } = await import(
        "./message-context-provider"
      )
      let context!: ReturnType<typeof useMessageContext>
      function Probe() {
        context = useMessageContext()
        return <p>{context.statusMessage?.message}</p>
      }
      const root = createRoot(container)
      const render = () =>
        root.render(
          <MessageContextProvider>
            <Probe />
          </MessageContextProvider>,
        )
      await act(async () => render())
      const oldUpdate = context.updateStatusMessage
      for (const destination of ["/license", "/"]) {
        pathname = destination
        await act(async () => render())
        await act(async () =>
          context.updateStatusMessage({ message: "Current notice" }),
        )
        await act(async () => oldUpdate(message === null ? null : { message }))
        expect(container.textContent).toBe("Current notice")
      }
      await act(async () => root.unmount())
    },
  )

  it("accepts completion notices after a step unmounts within the same route", async () => {
    const { MessageContextProvider, useMessageContext } = await import(
      "./message-context-provider"
    )
    let context!: ReturnType<typeof useMessageContext>
    function Probe() {
      context = useMessageContext()
      return <p>{context.statusMessage?.message}</p>
    }
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <MessageContextProvider>
          <Probe key="survey" />
        </MessageContextProvider>,
      ),
    )
    const complete = context.updateStatusMessage
    await act(async () =>
      root.render(
        <MessageContextProvider>
          <Probe key="thanks" />
        </MessageContextProvider>,
      ),
    )
    await act(async () =>
      complete({ message: "Submitted; local cleanup needs recovery" }),
    )
    expect(container.textContent).toBe(
      "Submitted; local cleanup needs recovery",
    )
    await act(async () => root.unmount())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("hydrates dismissed message ids from storage", async () => {
    window.localStorage.setItem(
      "aerpp:dismissed-information-message-ids",
      JSON.stringify(["info-1"]),
    )

    const { MessageContextProvider, useMessageContext } = await import(
      "./message-context-provider"
    )

    function Probe() {
      const { dismissedInformationMessageIds } = useMessageContext()
      return <div>{dismissedInformationMessageIds.join(",") || "none"}</div>
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MessageContextProvider>
          <Probe />
        </MessageContextProvider>,
      )
    })

    expect(container.textContent).toBe("info-1")
  })

  it("updates and clears the status message", async () => {
    const { MessageContextProvider, useMessageContext } = await import(
      "./message-context-provider"
    )

    function Probe() {
      const { statusMessage, updateStatusMessage } = useMessageContext()

      return (
        <div>
          <button
            type="button"
            onClick={() => updateStatusMessage({ message: "processing" })}
          >
            show
          </button>
          <button type="button" onClick={() => updateStatusMessage(null)}>
            clear
          </button>
          <div>
            {`${statusMessage?.message ?? "none"}:${statusMessage?.tone ?? "none"}`}
          </div>
        </div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MessageContextProvider>
          <Probe />
        </MessageContextProvider>,
      )
    })

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("processing:none")

    await act(async () => {
      container
        .querySelectorAll("button")[1]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("none:none")
  })

  it.each([false, true])(
    "clears dismissed IDs without writing storage, preserving the current notice only when requested: %s",
    async (preserveStatusMessage) => {
      window.localStorage.setItem(
        "aerpp:dismissed-information-message-ids",
        JSON.stringify(["info-1"]),
      )
      const { MessageContextProvider, useMessageContext } = await import(
        "./message-context-provider"
      )
      function Probe() {
        const {
          statusMessage,
          updateStatusMessage,
          dismissedInformationMessageIds,
          clearClientMessages,
        } = useMessageContext()
        return (
          <>
            <button
              type="button"
              onClick={() =>
                updateStatusMessage({ message: "Current page notice" })
              }
            >
              notify
            </button>
            <button
              type="button"
              onClick={() =>
                preserveStatusMessage
                  ? clearClientMessages({ preserveStatusMessage: true })
                  : clearClientMessages()
              }
            >
              reset messages
            </button>
            <div>{statusMessage?.message ?? "No notice"}</div>
            <div>
              {dismissedInformationMessageIds.join(",") || "No dismissed IDs"}
            </div>
          </>
        )
      }
      const root = createRoot(container)
      await act(async () =>
        root.render(
          <MessageContextProvider>
            <Probe />
          </MessageContextProvider>,
        ),
      )
      expect(container.textContent).toContain("info-1")
      await act(async () => container.querySelectorAll("button")[0]?.click())
      const writeStorage = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("Storage blocked", "SecurityError")
        })
      await act(async () => container.querySelectorAll("button")[1]?.click())
      expect(container.textContent).toContain("No dismissed IDs")
      expect(container.textContent).toContain(
        preserveStatusMessage ? "Current page notice" : "No notice",
      )
      expect(writeStorage).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )

  it("persists dismissed message ids and can reshow them", async () => {
    const { MessageContextProvider, useMessageContext } = await import(
      "./message-context-provider"
    )

    function Probe() {
      const {
        dismissInformationMessage,
        dismissedInformationMessageIds,
        resetDismissedInformationMessages,
      } = useMessageContext()

      return (
        <div>
          <button
            type="button"
            onClick={() => void dismissInformationMessage("info-2")}
          >
            dismiss
          </button>
          <button
            type="button"
            onClick={() => void resetDismissedInformationMessages()}
          >
            reshow
          </button>
          <div>{dismissedInformationMessageIds.join(",") || "none"}</div>
        </div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MessageContextProvider>
          <Probe />
        </MessageContextProvider>,
      )
    })

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("info-2")
    expect(
      window.localStorage.getItem("aerpp:dismissed-information-message-ids"),
    ).toBe('["info-2"]')

    await act(async () => {
      container
        .querySelectorAll("button")[1]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("none")
    expect(
      window.localStorage.getItem("aerpp:dismissed-information-message-ids"),
    ).toBe("[]")
  })

  it("keeps the application visible when browser storage access is denied", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError")
    })
    const { MessageContextProvider, useMessageContext } = await import(
      "./message-context-provider"
    )
    function Probe() {
      const { dismissedInformationMessageIds } = useMessageContext()
      return (
        <div>Application content: {dismissedInformationMessageIds.length}</div>
      )
    }
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <MessageContextProvider>
          <Probe />
        </MessageContextProvider>,
      )
    })
    expect(container.textContent).toBe("Application content: 0")
  })
})

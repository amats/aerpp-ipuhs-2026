/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import DocumentTabChip from "./document-tab-chip"

describe("DocumentTabChip", () => {
  let container: HTMLDivElement

  function getTabButton() {
    return container.querySelector('button[role="tab"]')
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("renders a tab button with the provided tab semantics", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DocumentTabChip
          documentKey="consent"
          title="説明文書"
          graphemeCount={1234}
          isActive={false}
          tabId="doc-tab-consent"
          panelId="doc-panel-consent"
          tabIndex={-1}
          onSelect={vi.fn()}
          onKeyDown={vi.fn()}
        />,
      )
    })

    const tabButton = getTabButton()

    expect(tabButton).toBeTruthy()
    expect(tabButton?.getAttribute("role")).toBe("tab")
    expect(tabButton?.getAttribute("id")).toBe("doc-tab-consent")
    expect(tabButton?.getAttribute("aria-controls")).toBe("doc-panel-consent")
    expect(tabButton?.getAttribute("aria-selected")).toBe("false")
    expect(tabButton?.getAttribute("tabindex")).toBe("-1")
  })

  it("selects the correct document without a close button", async () => {
    const root = createRoot(container)
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        <DocumentTabChip
          documentKey="9-1"
          title="添付 1"
          graphemeCount={12}
          isActive
          tabId="doc-tab-9-1"
          panelId="doc-panel-9-1"
          tabIndex={0}
          onSelect={onSelect}
          onKeyDown={vi.fn()}
        />,
      )
    })

    const tabButton = getTabButton()

    await act(async () => {
      tabButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledWith("9-1")
    expect(container.querySelectorAll("button")).toHaveLength(1)
  })
})

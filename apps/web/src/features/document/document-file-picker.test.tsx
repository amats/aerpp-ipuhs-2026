/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import DocumentFilePicker from "./document-file-picker"

describe("DocumentFilePicker", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("passes a stable file snapshot after file input selection", async () => {
    const handleFiles = vi.fn(async () => {})
    const file = new File(["sample text"], "sample.txt", {
      type: "text/plain",
    })
    const liveFiles = {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
      [Symbol.iterator]: function* () {
        yield file
      },
    } as FileList

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DocumentFilePicker
          cancelImport={vi.fn()}
          documentKey="0-application"
          isParsing={false}
          sourceFileName={null}
          handleFiles={handleFiles}
        />,
      )
    })

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement

    Object.defineProperty(input, "files", {
      configurable: true,
      get: () => liveFiles,
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(handleFiles).toHaveBeenCalledWith("0-application", [file])
  })

  it("connects file controls to format and status descriptions", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DocumentFilePicker
          cancelImport={vi.fn()}
          documentKey="0-application"
          isParsing={false}
          sourceFileName="sample.docx"
          statusMessage={{ message: "DOCXファイルを読み込みました。" }}
          handleFiles={vi.fn(async () => {})}
        />,
      )
    })

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "ファイルを選択",
    )
    const describedBy = input.getAttribute("aria-describedby")

    expect(input.getAttribute("aria-label")).toBe("解析する書類ファイルを選択")
    expect(button?.getAttribute("aria-describedby")).toBe(describedBy)
    expect(input.tabIndex).toBe(-1)
    expect(button?.tabIndex).toBe(0)
    const openPicker = vi.spyOn(input, "click")
    button?.focus()
    expect(document.activeElement).toBe(button)
    await act(async () => button?.click())
    expect(openPicker).toHaveBeenCalledTimes(1)
    for (const id of describedBy?.split(" ") ?? []) {
      expect(document.getElementById(id)?.textContent?.trim()).not.toBe("")
    }
  })

  it("ignores drops while parsing and accepts them after parsing finishes", async () => {
    const root = createRoot(container)
    const handleFiles = vi.fn(async () => {})
    const file = new File(["text"], "next.txt", { type: "text/plain" })
    for (const isParsing of [true, false]) {
      await act(async () => {
        root.render(
          <DocumentFilePicker
            cancelImport={vi.fn()}
            documentKey="document-1"
            isParsing={isParsing}
            sourceFileName={null}
            handleFiles={handleFiles}
          />,
        )
      })
      const input = container.querySelector("input") as HTMLInputElement
      expect(input.disabled).toBe(isParsing)
      const drop = new Event("drop", { bubbles: true, cancelable: true })
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } })
      await act(async () => {
        container.querySelector("section")?.dispatchEvent(drop)
      })
      if (isParsing) expect(handleFiles).not.toHaveBeenCalled()
      else expect(handleFiles).toHaveBeenCalledWith("document-1", [file])
    }
  })
})

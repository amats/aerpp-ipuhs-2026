/** @vitest-environment jsdom */

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { EMPTY_DOCUMENT_DRAFT } from "./document-draft-types"
import { useDocumentEditor } from "./use-document-editor"

const updateStatusMessage = vi.fn()
const startAnalysis = vi.fn()
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => {
    const [documentDraft, updateDocumentDraft] = useState(EMPTY_DOCUMENT_DRAFT)
    return {
      analysisJob: null,
      startAnalysis,
      documentDraft,
      updateDocumentDraft,
    }
  },
}))
vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({ updateStatusMessage }),
}))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
})

afterEach(() => vi.restoreAllMocks())

it.each(["clearDocument", "removeDocument"] as const)(
  "%s preserves the draft on cancellation and only discards it after confirmation",
  async (operation) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => editor.addDocument())
      const key = editor.activeDocumentKey
      const file = new File([""], "retained.txt", { type: "text/plain" })
      vi.spyOn(file, "text").mockResolvedValue("Retained document")
      await act(async () => editor.handleFiles(key, [file]))
      updateStatusMessage.mockClear()
      await act(async () => editor[operation](key))
      expect(confirm).toHaveBeenCalledOnce()
      expect(editor.documents[key]).toBe("Retained document")
      expect(editor.documentNames[key]).toBe("retained.txt")
      expect(editor.sourceFileNames[key]).toBe("retained.txt")
      expect(editor.activeDocumentKey).toBe(key)
      expect(updateStatusMessage).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      await act(async () => editor[operation](key))
      expect(editor.documents[key]).toBe(
        operation === "clearDocument" ? "" : undefined,
      )
      expect(editor.sourceFileNames[key]).toBeUndefined()
      confirm.mockClear()
      await act(async () => editor[operation]("document-1"))
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  },
)

it.each([false, true])(
  "blocks overlapping reads and allows a new read after completion (failed=%s)",
  async (failed) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => {
      root.render(<Probe />)
    })
    let finish!: () => void
    const firstText = new Promise<string>((resolve, reject) => {
      finish = () =>
        failed ? reject(new Error("read failed")) : resolve("FIRST document")
    })
    const firstFile = new File([""], "first.txt", { type: "text/plain" })
    const nextFile = new File([""], "next.txt", { type: "text/plain" })
    vi.spyOn(firstFile, "text").mockReturnValue(firstText)
    const nextRead = vi
      .spyOn(nextFile, "text")
      .mockResolvedValue("NEXT document")
    let firstRead!: Promise<void>
    // Dispatch both before a render so the guard cannot depend on React state.
    await act(async () => {
      firstRead = editor.handleFiles("document-1", [firstFile])
      await editor.handleFiles("document-1", [nextFile])
    })
    expect(editor.isParsing).toBe(true)
    expect(nextRead).not.toHaveBeenCalled()
    await act(async () => {
      await editor.handleFiles("document-1", [nextFile])
    })
    expect(nextRead).not.toHaveBeenCalled()
    expect(editor.isParsing).toBe(true)
    await act(async () => {
      finish()
      await firstRead
    })
    expect(editor.isParsing).toBe(false)
    expect(editor.documents["document-1"]).toBe(failed ? "" : "FIRST document")
    await act(async () => {
      await editor.handleFiles("document-1", [nextFile])
    })
    expect(editor.documents["document-1"]).toBe("NEXT document")
    expect(editor.documentNames["document-1"]).toBe("next.txt")
    expect(editor.isParsing).toBe(false)
  },
)

it.each(["success", "failure", "rejection"])(
  "guards analysis starts before rendering and releases the guard after %s",
  async (outcome) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    let finish!: () => void
    startAnalysis.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "rejection"
              ? reject(new Error("network unavailable"))
              : resolve({
                  ok: outcome === "success",
                  reason: "step_state_write_failed",
                })
        }),
    )
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        editor.updateDocument("document-1", "Retained body")
        editor.updateDocumentName("document-1", "Retained name")
      })
      let pending!: Promise<void>
      await act(async () => {
        pending = editor.handleStartAnalysis()
        await editor.handleStartAnalysis()
      })
      expect(startAnalysis).toHaveBeenCalledTimes(1)
      expect(editor.isStartingAnalysis).toBe(true)
      const file = new File([""], "ignored.txt", { type: "text/plain" })
      const read = vi.spyOn(file, "text").mockResolvedValue("Replacement body")
      await act(async () => editor.handleFiles("document-1", [file]))
      expect(read).not.toHaveBeenCalled()
      await act(async () => {
        finish()
        await pending
      })
      expect(editor.isStartingAnalysis).toBe(false)
      expect(editor.documents["document-1"]).toBe("Retained body")
      expect(editor.documentNames["document-1"]).toBe("Retained name")
      if (outcome !== "success") {
        expect(updateStatusMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ tone: "error" }),
        )
        startAnalysis.mockResolvedValueOnce({ ok: true })
        await act(async () => editor.handleStartAnalysis())
        expect(startAnalysis).toHaveBeenCalledTimes(2)
        expect(updateStatusMessage).toHaveBeenLastCalledWith(null)
      }
    } finally {
      await act(async () => root.unmount())
    }
  },
)

it.each([false, true])(
  "does not replace the next screen notice when a file read settles after unmount (failed=%s)",
  async (failed) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(<Probe />))
    let finish!: () => void
    const text = new Promise<string>((resolve, reject) => {
      finish = () =>
        failed
          ? reject(new Error("late read failure"))
          : resolve("late document")
    })
    const file = new File([""], "late.txt", { type: "text/plain" })
    vi.spyOn(file, "text").mockReturnValue(text)
    let pending!: Promise<void>
    await act(async () => {
      pending = editor.handleFiles("document-1", [file])
    })
    await act(async () => root.unmount())
    updateStatusMessage.mockClear()
    await act(async () => {
      finish()
      await pending
    })
    expect(updateStatusMessage).not.toHaveBeenCalled()
  },
)

it.each(["unsupported", "unreadable"])(
  "retains the current document and source filename when a replacement is %s",
  async (failure) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    try {
      await act(async () => root.render(<Probe />))
      const original = new File([""], "original.txt", { type: "text/plain" })
      vi.spyOn(original, "text").mockResolvedValue("Original body")
      await act(async () => editor.handleFiles("document-1", [original]))
      await act(async () => {
        editor.updateDocument("document-1", "Edited body")
        editor.updateDocumentName("document-1", "Edited name")
      })
      const replacement = new File(
        [""],
        failure === "unsupported" ? "replacement.pdf" : "replacement.txt",
        { type: failure === "unsupported" ? "application/pdf" : "text/plain" },
      )
      vi.spyOn(replacement, "text").mockRejectedValue(new Error("Read failed"))
      await act(async () => editor.handleFiles("document-1", [replacement]))

      expect(editor.documents["document-1"]).toBe("Edited body")
      expect(editor.documentNames["document-1"]).toBe("Edited name")
      expect(editor.sourceFileNames["document-1"]).toBe("original.txt")
      expect(editor.statusMessages["document-1"].tone).toBe("error")
      expect(editor.isParsing).toBe(false)
      expect(editor.canProceed).toBe(true)
    } finally {
      await act(async () => root.unmount())
    }
  },
)

it.each(["failure", "rejection"])(
  "does not replace the next screen notice when analysis start settles after unmount (%s)",
  async (outcome) => {
    let editor!: ReturnType<typeof useDocumentEditor>
    function Probe() {
      editor = useDocumentEditor()
      return null
    }
    const root = createRoot(document.createElement("div"))
    let finish!: () => void
    startAnalysis.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "rejection"
              ? reject(new Error("Late failure"))
              : resolve({ ok: false, reason: "step_state_write_failed" })
        }),
    )
    await act(async () => root.render(<Probe />))
    await act(async () => editor.updateDocument("document-1", "Retained body"))
    let pending!: Promise<void>
    await act(async () => {
      pending = editor.handleStartAnalysis()
    })
    await act(async () => root.unmount())
    updateStatusMessage.mockClear()
    await act(async () => {
      finish()
      await pending
    })
    expect(updateStatusMessage).not.toHaveBeenCalled()
  },
)

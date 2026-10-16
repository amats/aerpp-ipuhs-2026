import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { extractDocxText, extractPptxText } from "./document-file-extraction"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { preventDefault: () => void }) => void
  onmessageerror?: () => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    ControlledWorker.instances.push(this)
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  ControlledWorker.instances = []
  vi.stubGlobal("Worker", ControlledWorker)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("clones the File handle without reading the container and terminates after extraction", async () => {
  const file = new File(["synthetic"], "normal.docx")
  Object.defineProperty(file, "size", { value: 8_000_000_000 })
  const read = vi.spyOn(file, "arrayBuffer")
  const result = extractDocxText(file)
  await vi.waitFor(() => expect(ControlledWorker.instances).toHaveLength(1))
  const worker = ControlledWorker.instances[0]
  expect(worker.postMessage).toHaveBeenCalledWith({ kind: "docx", file })
  worker.onmessage?.({ data: { ok: true, text: "normal text" } })
  await expect(result).resolves.toBe("normal text")
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
})

it.each(["abort", "timeout", "error", "invalid-result"])(
  "terminates on %s and rejects late output",
  async (mode) => {
    const controller = new AbortController()
    const result = extractPptxText(
      new File(["synthetic"], "normal.pptx"),
      controller.signal,
    )
    const rejected = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(ControlledWorker.instances).toHaveLength(1))
    const worker = ControlledWorker.instances[0]
    if (mode === "abort") controller.abort()
    else if (mode === "timeout") vi.advanceTimersByTime(limits.timeoutMs)
    else if (mode === "error") worker.onerror?.({ preventDefault: vi.fn() })
    else worker.onmessage?.({ data: { ok: "true", text: "invalid" } })
    worker.onmessage?.({ data: { ok: true, text: "late text" } })
    await rejected
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  },
)

it("does not start a Worker or read the file when already cancelled", async () => {
  const file = new File([], "pending.docx")
  const read = vi.spyOn(file, "arrayBuffer")
  const controller = new AbortController()
  controller.abort()
  const result = extractDocxText(file, controller.signal)
  await expect(result).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
  expect(ControlledWorker.instances).toHaveLength(0)
})

import { expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { acquireExportWork } from "./export-work"

it.each(["resolve", "reject"] as const)(
  "holds the export slot until a cancelled SDK read settles (%s)",
  async (outcome) => {
    const work = acquireExportWork()
    if (!work) throw new Error("missing work")
    const read = Promise.withResolvers<void>()
    work.retain(read.promise)
    work.release()
    work.release()
    expect(acquireExportWork()).toBeNull()
    if (outcome === "resolve") read.resolve()
    else read.reject(new Error("late SDK failure"))
    await Promise.resolve()
    const next = acquireExportWork()
    expect(next).not.toBeNull()
    next?.release()
  },
)

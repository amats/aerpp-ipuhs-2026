import { expect, it } from "vitest"
import { readArchive } from "../../../test-support/read-archive"
import { exportArchive, exportDownloadArchive } from "./export-archive"
import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"

it("preserves archive bytes while checking cancellation between checksum chunks", async () => {
  const files = {
    "large.txt": "synthetic".repeat(200_000),
    "small.txt": "second",
  }
  const controller = new AbortController()
  const archive = await exportDownloadArchive(files, controller.signal)
  expect(archive).toEqual(exportArchive(files))
  expect(readArchive(archive)).toEqual(files)
  const pending = exportDownloadArchive(files, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
})

it("rejects oversized archives before creating a partial download", async () => {
  const files = { "large.txt": "x".repeat(limits.maxFileBytes + 1) }
  await expect(
    exportDownloadArchive(files, new AbortController().signal),
  ).rejects.toThrow("capacity")
})

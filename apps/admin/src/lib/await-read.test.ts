import { expect, it, vi } from "vitest"
import { awaitRead } from "./await-read"

it("consumes a late read rejection after cancellation and removes the listener", async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, "removeEventListener")
  const read = Promise.withResolvers<void>()
  const pending = awaitRead(read.promise, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  read.reject(new Error("late read failure"))
  await Promise.resolve()
  expect(remove).toHaveBeenCalledOnce()
})

it("consumes an already started read when cancellation precedes the wait", async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    awaitRead(Promise.reject(new Error("late failure")), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" })
})

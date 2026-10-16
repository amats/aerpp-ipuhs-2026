import { afterEach, expect, it, vi } from "vitest"
import { installSessionTokenCapture } from "./session-token-capture"

const TOKEN = `${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}:${"b".repeat(64)}`

afterEach(() => vi.unstubAllGlobals())

function capture(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response)
  const target = {
    fetch,
    __aerppTestSessionToken: undefined as string | undefined,
  }
  vi.stubGlobal("window", target)
  installSessionTokenCapture()
  return target
}

it("captures a split action token before the response stream finishes", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const response = new Response(
    new ReadableStream({
      start(value) {
        controller = value
      },
    }),
  )
  const target = capture(response)
  if (controller === undefined)
    throw new Error("Missing synthetic stream controller")
  expect(
    await target.fetch("http://example.invalid", {
      headers: { "next-action": "synthetic" },
    }),
  ).toBe(response)
  const bytes = new TextEncoder().encode(`0:{"sessionToken":"${TOKEN}"}\n`)
  controller.enqueue(bytes.slice(0, 40))
  await Promise.resolve()
  expect(target.__aerppTestSessionToken).toBeUndefined()
  controller.enqueue(bytes.slice(40))
  try {
    await vi.waitFor(() => expect(target.__aerppTestSessionToken).toBe(TOKEN))
  } finally {
    controller.close()
  }
})

it("captures header tokens without consuming an unrelated response body", async () => {
  const response = new Response("synthetic", {
    headers: { "x-aerpp-session-token": TOKEN },
  })
  const target = capture(response)
  expect(await target.fetch("http://example.invalid")).toBe(response)
  expect(target.__aerppTestSessionToken).toBe(TOKEN)
  expect(await response.text()).toBe("synthetic")
})

it("does not capture token-shaped data from ordinary response bodies", async () => {
  const response = new Response(`{"sessionToken":"${TOKEN}"}`)
  const target = capture(response)
  await target.fetch("http://example.invalid")
  expect(target.__aerppTestSessionToken).toBeUndefined()
  expect(response.bodyUsed).toBe(false)
})

it("keeps the original response usable when observing a canceled action stream", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("Synthetic cancellation"))
      },
    }),
  )
  const target = capture(response)
  expect(
    await target.fetch(
      new Request("http://example.invalid", {
        headers: { "next-action": "synthetic" },
      }),
    ),
  ).toBe(response)
  await expect(response.text()).rejects.toThrow("Synthetic cancellation")
})

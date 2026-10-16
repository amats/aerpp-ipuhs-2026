import { afterEach, expect, it, vi } from "vitest"
import { generateRandomIdSuffix } from "./random-id"

afterEach(() => vi.unstubAllGlobals())
it("rejects bytes outside an unbiased alphabet and still fills the requested length", () => {
  let calls = 0
  vi.stubGlobal("crypto", {
    getRandomValues: (buffer: Uint8Array) =>
      buffer.fill(calls++ === 0 ? 255 : 247),
  })
  expect(generateRandomIdSuffix(32)).toBe("9".repeat(32))
  expect(calls).toBe(2)
})
it("rejects exhausted or unavailable entropy without returning a short ID", () => {
  const random = vi.fn((buffer: Uint8Array) => buffer.fill(255))
  vi.stubGlobal("crypto", { getRandomValues: random })
  expect(generateRandomIdSuffix(32)).toBeNull()
  expect(random).toHaveBeenCalledTimes(32)
  vi.stubGlobal("crypto", undefined)
  expect(generateRandomIdSuffix(32)).toBeNull()
})
it("uses all alphabet characters and guards invalid lengths", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (buffer: Uint8Array) => buffer.map((_, index) => index),
  })
  expect(generateRandomIdSuffix(62)).toBe(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  )
  for (const length of [0, -1, 1.5, 257, Infinity])
    expect(generateRandomIdSuffix(length)).toBeNull()
})

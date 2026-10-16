import { expect, it } from "vitest"
import { retryAfterMs } from "./http-retry"

it("accepts delta seconds and dates without shortening a future Retry-After", () => {
  expect(retryAfterMs("120", 0)).toBe(120_000)
  expect(retryAfterMs("Thu, 01 Jan 1970 00:02:00 GMT", 1000)).toBe(119_000)
  for (const value of [null, "invalid", "-1", "1e400"])
    expect(retryAfterMs(value, 2_000_000_000_000)).toBe(0)
})

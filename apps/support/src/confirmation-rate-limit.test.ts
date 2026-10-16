import { expect, it } from "vitest"
import {
  createConfirmationLimiter,
  CONFIRMATION_REQUEST_LIMITS as limits,
} from "./confirmation-rate-limit.js"

it("bounds rate, refills against a monotonic clock, and isolates app instances", () => {
  let now = 0
  const limiter = createConfirmationLimiter(() => now)
  for (let i = 0; i < limits.burst; i++) {
    const permit = limiter.acquire()
    expect(permit.ok).toBe(true)
    if (permit.ok === true) permit.release()
  }
  expect(limiter.acquire()).toEqual({ ok: false, retryAfterSeconds: 1 })
  now = -1000
  expect(limiter.acquire().ok).toBe(false)
  now = 1000
  const retry = limiter.acquire()
  expect(retry.ok).toBe(true)
  if (retry.ok === true) retry.release()
  expect(limiter.acquire().ok).toBe(false)
  expect(createConfirmationLimiter(() => now).acquire().ok).toBe(true)
})

it("holds up to twenty operations, restores slots, and makes release idempotent", () => {
  const limiter = createConfirmationLimiter(() => 0)
  const permits = Array.from({ length: limits.maxInFlight }, () =>
    limiter.acquire(),
  )
  expect(permits.every((permit) => permit.ok === true)).toBe(true)
  expect(limiter.acquire().ok).toBe(false)
  const first = permits[0]
  if (first.ok === true) {
    first.release()
    first.release()
  }
  expect(limiter.acquire().ok).toBe(true)
  expect(limiter.acquire().ok).toBe(false)
})

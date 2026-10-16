// Ten simultaneous participants can each retry without allocating per-ID/IP
// state. These ceilings apply to one Support process, including invalid links.
export const CONFIRMATION_REQUEST_LIMITS = {
  burst: 60,
  perMinute: 60,
  maxInFlight: 20,
} as const

export function createConfirmationLimiter(now = () => performance.now()) {
  let tokens: number = CONFIRMATION_REQUEST_LIMITS.burst
  let refilled = now()
  let inFlight = 0
  return {
    acquire():
      | { ok: false; retryAfterSeconds: number }
      | { ok: true; release: () => void } {
      const current = Math.max(refilled, now())
      tokens = Math.min(
        CONFIRMATION_REQUEST_LIMITS.burst,
        tokens +
          ((current - refilled) * CONFIRMATION_REQUEST_LIMITS.perMinute) /
            60000,
      )
      refilled = current
      if (tokens < 1 || inFlight >= CONFIRMATION_REQUEST_LIMITS.maxInFlight)
        return {
          ok: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              ((1 - tokens) * 60) / CONFIRMATION_REQUEST_LIMITS.perMinute,
            ),
          ),
        }
      tokens--
      inFlight++
      let released = false
      return {
        ok: true,
        release: () => {
          if (released === true) return
          released = true
          inFlight--
        },
      }
    },
  }
}

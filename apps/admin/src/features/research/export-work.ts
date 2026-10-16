import "server-only"

import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"

let active = 0

export function acquireExportWork() {
  if (active >= limits.maxConcurrent) return null
  active += 1
  let released = false
  let retained = 0
  let settled = false
  function finish() {
    if (released === true && retained === 0 && settled !== true) {
      settled = true
      active -= 1
    }
  }
  return {
    retain(pending: Promise<unknown>) {
      retained += 1
      const done = () => {
        retained -= 1
        finish()
      }
      // Cancellation of the HTTP wait cannot free a still-running SDK read.
      void pending.then(done, done)
    },
    release() {
      released = true
      finish()
    },
  }
}

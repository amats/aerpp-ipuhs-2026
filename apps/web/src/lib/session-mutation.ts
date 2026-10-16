"use client"

import { waitForTabOperation } from "./tab-cancellation"

export const SESSION_BUSY_MESSAGE =
  "別の処理が進行中か、前の処理の終了を確認できません。入力を保持したまま、時間をおいて同じ操作を再試行してください。同じ状態が続く場合は、研究者にご連絡ください。"
export type SessionMutationFailure = {
  ok: false
  reason: "session_busy" | "superseded_operation"
}

const slowOperations = new Set<symbol>()
const waitingListeners = new Set<() => void>()
export const isSessionMutationSlow = () => slowOperations.size > 0
export function subscribeSessionMutationWaiting(listener: () => void) {
  waitingListeners.add(listener)
  return () => {
    waitingListeners.delete(listener)
  }
}

// Server hash comparison serializes mutations. Ordinary browser operations do
// not acquire tab ownership or a browser-wide operation lock.
export async function runSessionMutation<T>(operation: () => Promise<T>) {
  const id = Symbol()
  const timer = setTimeout(() => {
    slowOperations.add(id)
    for (const listener of waitingListeners) listener()
  }, 15_000)
  try {
    return await waitForTabOperation(operation())
  } finally {
    clearTimeout(timer)
    if (slowOperations.delete(id))
      for (const listener of waitingListeners) listener()
  }
}
export function guardSessionMutation<Args extends unknown[], T>(
  operation: (...args: Args) => Promise<T>,
) {
  return (...args: Args) => runSessionMutation(() => operation(...args))
}

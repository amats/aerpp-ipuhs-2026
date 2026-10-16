"use client"

import { useState } from "react"
import type { StepStateTransitionResult } from "@/features/app-context/app-context-types"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"

export function useIntroNavigation({
  moveNext,
  failureMessage,
}: {
  moveNext: () => Promise<StepStateTransitionResult>
  failureMessage: string
}) {
  const { updateStatusMessage } = useMessageContext()
  const [isMovingNext, setIsMovingNext] = useState(false)

  async function handleMoveToNext() {
    setIsMovingNext(true)
    try {
      const transition = await moveNext()
      if (
        transition.ok !== true &&
        transition.reason === "superseded_operation"
      )
        return
      updateStatusMessage(
        transition.ok === true
          ? null
          : (getSessionFailureStatus(transition.reason) ?? {
              message: failureMessage,
              tone: "error",
            }),
      )
    } catch {
      updateStatusMessage({ message: failureMessage, tone: "error" })
    } finally {
      setIsMovingNext(false)
    }
  }

  return { isMovingNext, handleMoveToNext }
}

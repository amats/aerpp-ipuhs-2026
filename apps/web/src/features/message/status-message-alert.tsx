"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import ReloadPageButton from "@/features/session/reload-page-button"
import { SESSION_RELOAD_NOTICE } from "@/features/session/session-recovery"
import {
  isSessionMutationSlow,
  subscribeSessionMutationWaiting,
} from "@/lib/session-mutation"
import AlertMessage from "@/ui/alert-message"
import { AlertTone } from "@/ui/alert-tone"
import { useMessageContext } from "./message-context-provider"

export default function StatusMessageAlert() {
  const { statusMessage } = useMessageContext()
  const alertRef = useRef<HTMLElement | null>(null)
  const slow = useSyncExternalStore(
    subscribeSessionMutationWaiting,
    isSessionMutationSlow,
    () => false,
  )

  useEffect(() => {
    if (statusMessage?.tone !== AlertTone.error) {
      return
    }
    alertRef.current?.focus()
  }, [statusMessage])

  if (!statusMessage) {
    return slow ? (
      <AlertMessage tone={AlertTone.info}>
        処理の確認に時間がかかっています。入力を保持したまま、しばらくお待ちください。
      </AlertMessage>
    ) : null
  }

  return (
    <AlertMessage ref={alertRef} tone={statusMessage.tone ?? AlertTone.info}>
      {statusMessage.recovery === "reload" ? (
        <>
          {statusMessage.message}
          <p>{SESSION_RELOAD_NOTICE}</p>
          <ReloadPageButton />
        </>
      ) : (
        statusMessage.message
      )}
    </AlertMessage>
  )
}

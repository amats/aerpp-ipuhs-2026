"use client"

import { useAppContext } from "@/features/app-context/app-context-provider"
import { useMessageContext } from "@/features/message/message-context-provider"
import { BrowserStorageKey } from "@/lib/browser-storage"
import DebugSnapshotPanel from "./debug-snapshot-panel"
import { useDebugStorageSnapshot } from "./use-debug-storage-snapshot"

type ClientDebugSnapshot = {
  appContext: {
    stage: string
    step: string
    statusMessage: {
      message: string
      tone?: string
    } | null
    dismissedInformationMessageIds: string[]
  }
  localStorage: ReturnType<typeof useDebugStorageSnapshot>
}

function buildStorageSnapshot(): Record<string, string | null> {
  return {
    [BrowserStorageKey.dismissedInformationMessageIds]:
      window.localStorage.getItem(
        BrowserStorageKey.dismissedInformationMessageIds,
      ),
  }
}

export default function DebugClientPanel() {
  const { stage, stepState } = useAppContext()
  const { statusMessage, dismissedInformationMessageIds } = useMessageContext()

  const snapshot: ClientDebugSnapshot = {
    appContext: {
      stage,
      step: stepState.step,
      statusMessage,
      dismissedInformationMessageIds,
    },
    localStorage: useDebugStorageSnapshot(buildStorageSnapshot),
  }

  return (
    <DebugSnapshotPanel
      title="App context client snapshot"
      snapshot={snapshot}
    />
  )
}

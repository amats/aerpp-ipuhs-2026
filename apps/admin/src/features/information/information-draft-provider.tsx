"use client"

import type { InformationTarget } from "@aerpp/firestore/information-types"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

type DraftFields = {
  content: string
  tone: string
  expireAt: string
  timeZone: string
}

type InformationDraft = DraftFields & {
  editing: InformationTarget | null
  editingConflict: boolean
}

type DraftMessage = { text: string; kind: "error" | "success" } | null

const EMPTY_DRAFT: InformationDraft = {
  editing: null,
  editingConflict: false,
  content: "",
  tone: "info",
  expireAt: "",
  timeZone: "Asia/Tokyo",
}

const InformationDraftContext = createContext<{
  draft: InformationDraft
  isDirty: boolean
  updateDraft: (fields: Partial<InformationDraft>) => void
  replaceDraft: (draft: InformationDraft) => void
  resetDraft: () => void
  confirmDiscard: () => boolean
  message: DraftMessage
  setMessage: (message: DraftMessage) => void
  operationPending: boolean
  beginOperation: () => boolean
  finishOperation: () => void
} | null>(null)

export default function InformationDraftProvider({
  children,
}: {
  children: ReactNode
}) {
  // Keep drafts in this tab's memory across client navigation, including Back/Forward.
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState<DraftFields>(EMPTY_DRAFT)
  const discardedRef = useRef(false)
  const operationRef = useRef(false)
  const [operationPending, setOperationPending] = useState(false)
  const [message, setMessage] = useState<DraftMessage>(null)
  const isDirty =
    draft.content !== baseline.content ||
    draft.tone !== baseline.tone ||
    draft.expireAt !== baseline.expireAt ||
    draft.timeZone !== baseline.timeZone

  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (discardedRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  function updateDraft(fields: Partial<InformationDraft>) {
    discardedRef.current = false
    setDraft((previous) => ({ ...previous, ...fields }))
  }

  function replaceDraft(next: InformationDraft) {
    setDraft(next)
    setBaseline(next)
  }

  function resetDraft() {
    discardedRef.current = true
    replaceDraft({ ...EMPTY_DRAFT, timeZone: draft.timeZone })
  }

  function confirmDiscard() {
    return (
      !isDirty ||
      window.confirm(
        "保存していないお知らせの変更を破棄します。この操作は取り消せません。続けますか？",
      )
    )
  }

  function beginOperation() {
    if (operationRef.current) return false
    operationRef.current = true
    setOperationPending(true)
    return true
  }

  function finishOperation() {
    operationRef.current = false
    setOperationPending(false)
  }

  return (
    <InformationDraftContext
      value={{
        draft,
        isDirty,
        updateDraft,
        replaceDraft,
        resetDraft,
        confirmDiscard,
        message,
        setMessage,
        operationPending,
        beginOperation,
        finishOperation,
      }}
    >
      {children}
    </InformationDraftContext>
  )
}

export function useInformationDraft() {
  const context = useContext(InformationDraftContext)
  if (!context) throw new Error("InformationDraftProvider is required")
  return context
}

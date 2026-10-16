"use client"

import { useEffect, useState } from "react"
import AlertMessage from "@/ui/alert-message"
import {
  getInformationMessagesAction,
  type InformationMessage,
} from "./actions-message"
import { useMessageContext } from "./message-context-provider"

export default function InformationMessageList() {
  const {
    dismissInformationMessage,
    dismissedInformationMessageIds,
    replaceDismissedInformationMessages,
  } = useMessageContext()

  const [messages, setMessages] = useState<InformationMessage[] | null>(null)

  useEffect(() => {
    let active = true
    async function fetchMessages() {
      try {
        const informationMessages = await getInformationMessagesAction()
        if (active) setMessages(informationMessages)
      } catch {
        // A failed read must not erase the participant's dismissed message IDs.
      }
    }
    void fetchMessages()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (messages === null) return
    const currentIds = new Set(messages.map((message) => message.id))
    const filteredIds = dismissedInformationMessageIds.filter((id) =>
      currentIds.has(id),
    )
    if (filteredIds.length !== dismissedInformationMessageIds.length) {
      void replaceDismissedInformationMessages(filteredIds).catch(() => {
        // Display preferences can still be updated in memory when storage fails.
      })
    }
  }, [
    messages,
    dismissedInformationMessageIds,
    replaceDismissedInformationMessages,
  ])

  async function handleDismissMessage(id: string) {
    try {
      await dismissInformationMessage(id)
    } catch {
      // The provider has already applied the dismissal for this page.
    }
  }

  const visibleMessages = (messages ?? []).filter(
    (message) => !dismissedInformationMessageIds.includes(message.id),
  )

  return (
    <>
      {visibleMessages.map((message) => (
        <AlertMessage
          key={message.id}
          tone={message.tone}
          onDismiss={() => handleDismissMessage(message.id)}
        >
          <span className="whitespace-pre-wrap">{message.content}</span>
        </AlertMessage>
      ))}
    </>
  )
}

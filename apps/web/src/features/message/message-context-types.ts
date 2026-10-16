import type { AlertTone } from "@/ui/alert-tone"

export type StatusMessage = {
  message: string
  tone?: AlertTone
  recovery?: "reload"
}

export type UpdateStatusMessage = (statusMessage: StatusMessage | null) => void

export type MessageContextState = {
  statusMessage: StatusMessage | null
  dismissedInformationMessageIds: string[]
}

export type MessageContextActions = {
  clearClientMessages: (options?: { preserveStatusMessage?: boolean }) => void
  updateStatusMessage: UpdateStatusMessage
  dismissInformationMessage: (messageId: string) => Promise<void>
  replaceDismissedInformationMessages: (messageIds: string[]) => Promise<void>
  resetDismissedInformationMessages: () => Promise<void>
}

export type MessageContextValue = {
  state: MessageContextState
  actions: MessageContextActions
}

export type MessageContextPublicValue = MessageContextState &
  MessageContextActions

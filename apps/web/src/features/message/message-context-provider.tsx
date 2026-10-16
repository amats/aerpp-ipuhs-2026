"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  readDismissedInformationMessageIdsFromLocalStorage,
  saveDismissedInformationMessageIdsToLocalStorage,
} from "@/lib/browser-storage"
import type {
  MessageContextActions,
  MessageContextState,
  MessageContextValue,
  StatusMessage,
} from "./message-context-types"

const initialMessageState: MessageContextState = {
  statusMessage: null,
  dismissedInformationMessageIds: [],
}

const defaultMessageActions: MessageContextActions = {
  clearClientMessages: () => {},
  updateStatusMessage: () => {},
  dismissInformationMessage: async () => {},
  replaceDismissedInformationMessages: async () => {},
  resetDismissedInformationMessages: async () => {},
}

const MessageContext = createContext<MessageContextValue>({
  state: initialMessageState,
  actions: defaultMessageActions,
})

export function MessageContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const routeScope = useMemo(() => ({ pathname }), [pathname])
  const activeRouteScopeRef = useRef<typeof routeScope | null>(routeScope)
  useLayoutEffect(() => {
    activeRouteScopeRef.current = routeScope
    return () => {
      activeRouteScopeRef.current = null
    }
  }, [routeScope])

  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(
    initialMessageState.statusMessage,
  )
  const [dismissedInformationMessageIds, setDismissedInformationMessagesState] =
    useState<string[]>(initialMessageState.dismissedInformationMessageIds)

  const loadStoredState = useEffectEvent(() => {
    const storedDismissedInformationMessages =
      readDismissedInformationMessageIdsFromLocalStorage()
    setDismissedInformationMessagesState(storedDismissedInformationMessages)
  })

  useEffect(() => {
    loadStoredState()
  }, [])

  const updateStatusMessage = useCallback(
    (nextStatusMessage: StatusMessage | null) => {
      // A late response belongs to the route that started it. Step changes on
      // the same route still need completion and local-cleanup notices.
      if (activeRouteScopeRef.current !== routeScope) return
      setStatusMessage(nextStatusMessage)
    },
    [routeScope],
  )

  const clearClientMessages = useCallback<
    MessageContextActions["clearClientMessages"]
  >((options) => {
    if (options?.preserveStatusMessage !== true) setStatusMessage(null)
    setDismissedInformationMessagesState([])
  }, [])

  const persistDismissedInformationMessages = useCallback(
    (messages: string[]) => {
      setDismissedInformationMessagesState(messages)
      saveDismissedInformationMessageIdsToLocalStorage(messages)
    },
    [],
  )

  const dismissInformationMessage = useCallback(
    async (messageId: string) => {
      const nextDismissedInformationMessages = [
        ...new Set([...dismissedInformationMessageIds, messageId]),
      ]
      persistDismissedInformationMessages(nextDismissedInformationMessages)
    },
    [dismissedInformationMessageIds, persistDismissedInformationMessages],
  )

  const replaceDismissedInformationMessages = useCallback(
    async (messageIds: string[]) => {
      persistDismissedInformationMessages(messageIds)
    },
    [persistDismissedInformationMessages],
  )

  const resetDismissedInformationMessages = useCallback(async () => {
    persistDismissedInformationMessages([])
  }, [persistDismissedInformationMessages])

  const state = useMemo(
    () => ({
      statusMessage,
      dismissedInformationMessageIds,
    }),
    [statusMessage, dismissedInformationMessageIds],
  )

  const actions = useMemo(
    () => ({
      clearClientMessages,
      updateStatusMessage,
      dismissInformationMessage,
      replaceDismissedInformationMessages,
      resetDismissedInformationMessages,
    }),
    [
      clearClientMessages,
      updateStatusMessage,
      dismissInformationMessage,
      replaceDismissedInformationMessages,
      resetDismissedInformationMessages,
    ],
  )

  return (
    <MessageContext.Provider value={{ state, actions }}>
      {children}
    </MessageContext.Provider>
  )
}

export function useMessageContext() {
  const { state, actions } = use(MessageContext)

  return {
    ...state,
    ...actions,
  }
}

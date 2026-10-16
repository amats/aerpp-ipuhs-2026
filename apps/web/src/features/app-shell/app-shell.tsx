import { env } from "@aerpp/config/server/web"
import { connection } from "next/server"
import { AppContextProvider } from "@/features/app-context/app-context-provider"
import { readInitialStepState } from "@/features/app-context/step-state-session"
import AppFooter from "@/features/app-shell/app-footer"
import AppHeader from "@/features/app-shell/app-header"
import RouteFocusBoundary from "@/features/app-shell/route-focus-boundary"
import MessageArea from "@/features/message/message-area"
import { MessageContextProvider } from "@/features/message/message-context-provider"
import ReceptionBoundary from "@/features/reception/reception-boundary"
import ReceptionClosed from "@/features/reception/reception-closed"
import { APP_VERSION } from "@/lib/version"

// Server entry for session hydration, shared providers, and application chrome.
export default async function AppShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  await connection()
  if (Date.now() >= env.receptionExpiresAt.getTime())
    return <ReceptionClosed contactEmail={env.supportContactEmail} />
  const stepState = await readInitialStepState()
  const remainingMs = env.receptionExpiresAt.getTime() - Date.now()
  if (remainingMs <= 0)
    return <ReceptionClosed contactEmail={env.supportContactEmail} />

  return (
    <ReceptionBoundary
      remainingMs={remainingMs}
      contactEmail={env.supportContactEmail}
    >
      <AppContextProvider initialStepState={stepState}>
        <MessageContextProvider>
          <AppHeader />
          <MessageArea />
          <RouteFocusBoundary className={className}>
            {children}
          </RouteFocusBoundary>
          <AppFooter
            appVersion={APP_VERSION}
            showDevelopmentLinks={env.debugPagesEnabled}
          />
        </MessageContextProvider>
      </AppContextProvider>
    </ReceptionBoundary>
  )
}

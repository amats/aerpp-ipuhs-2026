"use client"

import { signOut } from "next-auth/react"
import { useInformationDraft } from "@/features/information/information-draft-provider"

export default function AppHeaderActions({
  email,
  adminAuthBypassEnabled,
}: {
  email: string | null
  adminAuthBypassEnabled: boolean
}) {
  const { confirmDiscard, resetDraft } = useInformationDraft()
  return (
    <div className="flex min-w-0 flex-col items-start gap-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/90">
          {adminAuthBypassEnabled ? "Local mode" : "Signed in"}
        </p>
        <p className="break-all font-medium text-white">
          {adminAuthBypassEnabled
            ? "Authentication skipped for local testing"
            : (email ?? "Unknown account")}
        </p>
      </div>
      {adminAuthBypassEnabled !== true ? (
        <button
          type="button"
          onClick={() => {
            if (!confirmDiscard()) return
            resetDraft()
            void signOut({ callbackUrl: "/" })
          }}
          className="min-h-11 shrink-0 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          サインアウト
        </button>
      ) : null}
    </div>
  )
}

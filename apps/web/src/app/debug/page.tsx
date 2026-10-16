import { env } from "@aerpp/config/server/web"
import { notFound } from "next/navigation"
import { listParticipationEvents } from "@/features/auth/auth-service"
import DebugClientPanel from "@/features/debug/debug-client-panel"
import { readParticipationDebugSnapshotFromSession } from "@/features/debug/debug-participation-snapshot"
import DebugRefreshButton from "@/features/debug/debug-refresh-button"
import { readPseudonymFromSession } from "@/features/identity/participant-identifiers"
import { getSession } from "@/lib/session"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export const dynamic = "force-dynamic"

type ParticipationEventRecords = Array<{
  eventAt: string
  eventType: "consent" | "withdrawal"
}>

function sanitizeEndpointUrl(value: string) {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}

export default async function DebugPage() {
  if (env.debugPagesEnabled !== true) notFound()
  let consentRecords: ParticipationEventRecords = []
  let sessionError: string | null = null
  let participation: Awaited<
    ReturnType<typeof readParticipationDebugSnapshotFromSession>
  > | null = null

  try {
    const session = await getSession()
    const pseudonym = await readPseudonymFromSession(session)
    participation = await readParticipationDebugSnapshotFromSession(session)
    consentRecords = (await listParticipationEvents(pseudonym)).map(
      (record) => ({
        eventAt: record.eventAt.toISOString(),
        eventType: record.eventType,
      }),
    )
  } catch (error) {
    sessionError = error instanceof Error ? error.name : "UnknownError"
  }

  const serverSnapshot = {
    nodeEnv: env.nodeEnv,
    sessionError,
    participation,
  }

  const endpointSnapshot = {
    listParticipationEventsUrl: sanitizeEndpointUrl(
      env.listParticipationEventsUrl,
    ),
    sendMagicLinkUrl: sanitizeEndpointUrl(env.sendMagicLinkUrl),
    recordAnalysisCompletionUrl: sanitizeEndpointUrl(
      env.recordAnalysisCompletionUrl,
    ),
    submitSurveyUrl: sanitizeEndpointUrl(env.submitSurveyUrl),
    verifyAuthenticationUrl: sanitizeEndpointUrl(env.verifyAuthenticationUrl),
    withdrawParticipationUrl: sanitizeEndpointUrl(env.withdrawParticipationUrl),
  }

  return (
    <CardSection className="gap-5">
      <SectionHeading
        eyebrow="Debug"
        title="Runtime debug snapshot"
        description="開発・デバッグ時に、session と survey 状態をまとめて確認するためのページです。production では無効化されます。"
      />
      <DebugRefreshButton />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardPanel className="p-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Server snapshot
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              現在のセッションの参加区分と進行状態です。
            </p>
          </div>
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll the snapshot.
            tabIndex={0}
            aria-label="Server snapshot"
            className="mt-4 overflow-x-auto rounded-xl bg-slate-950/95 p-4 text-xs leading-relaxed text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
          >
            <pre>{JSON.stringify(serverSnapshot, null, 2)}</pre>
          </section>
        </CardPanel>

        <CardPanel className="p-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Endpoint snapshot
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              現在参照している外部 endpoint の設定値です。
            </p>
          </div>
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll the snapshot.
            tabIndex={0}
            aria-label="Endpoint snapshot"
            className="mt-4 overflow-x-auto rounded-xl bg-slate-950/95 p-4 text-xs leading-relaxed text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
          >
            <pre>{JSON.stringify(endpointSnapshot, null, 2)}</pre>
          </section>
        </CardPanel>

        <CardPanel className="p-5 xl:col-span-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Consent records
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              `listParticipationEvents()` の取得結果です。
            </p>
          </div>
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll the snapshot.
            tabIndex={0}
            aria-label="Consent records"
            className="mt-4 overflow-x-auto rounded-xl bg-slate-950/95 p-4 text-xs leading-relaxed text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
          >
            <pre>{JSON.stringify(consentRecords, null, 2)}</pre>
          </section>
        </CardPanel>

        <DebugClientPanel />
      </div>
    </CardSection>
  )
}

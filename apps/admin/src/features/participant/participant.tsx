import { DATA_PURPOSE_LABELS } from "@aerpp/firestore/data-purpose-types"
import DataLoadError from "@/features/app-shell/data-load-error"
import { formatDateTime } from "@/features/monitoring/participant-records"
import RecentActivityList from "@/features/monitoring/recent-activity-list"
import { loadParticipantPageData } from "@/features/participant/load-participant-page-data"
import { loadPageData } from "@/lib/load-page-data"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import DocumentVerificationForm from "./document-verification-form"
import ParticipationRecoveryLookup from "./participation-recovery-lookup"
import { RECOVERY_LABELS } from "./participation-recovery-types"

export default async function ParticipantPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const result = await loadPageData("loadParticipantPageData", () =>
    loadParticipantPageData(resolvedSearchParams?.dataPurpose),
  )
  if (!result.ok) return <DataLoadError />
  const data = result.data

  return (
    <CardSection>
      <SectionHeading eyebrow="Participants" title="同意・撤回の履歴" />
      <div className="grid gap-4 md:grid-cols-3">
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            最新状態の人数
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.trackedParticipants}
          </p>
        </CardPanel>
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            同意履歴レコード
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.totalRecords}
          </p>
        </CardPanel>
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            eventType 種別数
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.latestStatusCounts.length}
          </p>
        </CardPanel>
      </div>

      <CardPanel className="flex flex-col gap-4 p-5">
        <SectionHeading
          eyebrow="Latest Participant Updates"
          title="直近の参加者更新"
        />
        <RecentActivityList items={data.recentActivity} />
      </CardPanel>

      <CardPanel>
        <DocumentVerificationForm />
      </CardPanel>
      <CardPanel>
        <ParticipationRecoveryLookup />
      </CardPanel>
      <CardPanel
        as="section"
        aria-labelledby="recovery-authorizations-heading"
        className="p-5"
      >
        <h2
          id="recovery-authorizations-heading"
          className="text-lg font-semibold"
        >
          参加再開の許可記録
        </h2>
        <ul className="grid min-w-0 gap-3">
          {data.recoveryAuthorizations.map((record) => (
            <li
              key={record.id}
              className="min-w-0 rounded border p-3 wrap-anywhere"
            >
              <p>
                PID: {record.pseudonym} /{" "}
                {RECOVERY_LABELS[
                  record.destination as keyof typeof RECOVERY_LABELS
                ] ?? (record.kind === "initial" ? "初回" : "2回目以降")}
                {record.analysisId && ` / 解析ID: ${record.analysisId}`}
              </p>
              <p>{record.reason}</p>
              <p>
                許可:{" "}
                {formatDateTime(
                  record.authorizedAt === null
                    ? null
                    : new Date(record.authorizedAt),
                )}
              </p>
              <p>
                適用:{" "}
                {record.consumedAt === null
                  ? record.supersededBy
                    ? "差し替え済み"
                    : "未適用"
                  : formatDateTime(new Date(record.consumedAt))}
              </p>
              <p className="text-xs wrap-anywhere">
                研究者ID: {record.actorId}
              </p>
            </li>
          ))}
        </ul>
      </CardPanel>
      <CardPanel className="overflow-hidden p-0">
        <p className="px-4 py-3 text-sm">
          同意履歴：全{data.summary.totalRecords}件中、最新{data.records.length}
          件を表示しています。
          同意申請の受付日時と、メールで同意を確認した日時を分けて表示します。撤回は受付日時です。
        </p>
        <section
          aria-label="同意・撤回の履歴"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide table.
          tabIndex={0}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--brand)"
        >
          <table className="w-full min-w-max divide-y divide-slate-200 text-sm dark:divide-white/10">
            <thead className="whitespace-nowrap bg-slate-50 dark:bg-slate-950/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  同意申請日時
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  同意確認・撤回受付日時
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  pseudonym
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  clientId
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  eventType
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  serverId / 区分
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-white/10 dark:bg-slate-900/70">
              {data.records.map((record) => (
                <tr key={record.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.eventType === "consent"
                      ? formatDateTime(record.consentRequestedAt)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatDateTime(record.eventAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {record.pseudonym}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.clientId}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.eventType}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.serverId} /{" "}
                    {DATA_PURPOSE_LABELS[record.dataPurpose]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </CardPanel>
    </CardSection>
  )
}

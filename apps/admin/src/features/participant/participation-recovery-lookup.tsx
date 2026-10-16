"use client"

import { useActionState, useState } from "react"
import { lookupParticipationRecoveryAction } from "./actions-recovery-lookup"
import DocumentReissueForm from "./document-reissue-form"
import ParticipationRecoveryForm from "./participation-recovery-form"
import type {
  RecoveryLookupActionState,
  RecoveryRecord,
} from "./participation-recovery-lookup-types"

function RecordDetails({ record }: { record: RecoveryRecord }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs">記録ID: {record.id}</p>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {record.fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500 dark:text-slate-400">
              {label}
            </dt>
            <dd className="text-sm whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function RecordList({
  title,
  records,
}: {
  title: string
  records: RecoveryRecord[]
}) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="font-semibold">
        {title}（{records.length}件）
      </h3>
      {records.length === 0 ? (
        <p className="text-sm">該当する記録はありません。</p>
      ) : (
        <ul className="grid gap-2">
          {records.map((record) => (
            <li key={record.id}>
              <RecordDetails record={record} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function ParticipationRecoveryLookup() {
  const [mode, setMode] = useState("pid")
  const [requestId, setRequestId] = useState(0)
  const [state, action, pending] = useActionState(
    lookupParticipationRecoveryAction,
    { message: "" } as RecoveryLookupActionState,
  )
  const lookup =
    pending !== true && state.requestId === String(requestId)
      ? state.lookup
      : undefined
  return (
    <div className="grid min-w-0 gap-4 p-5 wrap-anywhere">
      <h2 className="text-lg font-semibold">研究責任者による復旧</h2>
      <p className="text-sm">
        まず対象PIDの記録を照会し、参加者への確認と合わせて復旧方針を決めてください。照会だけでは復旧を許可しません。
      </p>
      <form
        action={action}
        onReset={(event) => {
          // Keep the native selection and input aligned with the lookup mode.
          event.preventDefault()
        }}
        className="grid w-full min-w-0 max-w-2xl gap-3"
      >
        <fieldset disabled={pending} className="grid min-w-0 gap-3">
          <label>
            照会方法
            <select
              name="mode"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value)
                setRequestId((id) => id + 1)
              }}
              className="block w-full rounded border p-2"
            >
              <option value="pid">PIDで照会</option>
              <option value="email">メールアドレスからPIDを生成して照会</option>
            </select>
          </label>
          <label>
            {mode === "email" ? "参加者メールアドレス" : "参加者PID"}
            <input
              key={mode}
              name="value"
              type="text"
              inputMode={mode === "email" ? "email" : "text"}
              autoComplete="off"
              required
              maxLength={256}
              onChange={() => setRequestId((id) => id + 1)}
              className="block w-full min-w-0 rounded border p-2"
            />
          </label>
          <input type="hidden" name="requestId" value={requestId} />
          <button type="submit" className="rounded border p-2">
            {pending ? "照会中…" : "PIDの記録を照会する"}
          </button>
        </fieldset>
      </form>
      {state.message !== "" && <p role="status">{state.message}</p>}
      {lookup && (
        <div key={lookup.loadedAt} className="grid min-w-0 gap-4">
          <p className="font-semibold">PID: {lookup.pseudonym}</p>
          <p className="text-sm">
            照会時点の履歴の対象サーバー: {lookup.serverId} ／
            全区分（研究・テスト・未分類）。現在の参加状態は環境全体で共有されます。
          </p>
          <p className="text-sm">
            保存されている記録のみを表示します。表示許可日時は参加者が結果を実際に参照した証拠ではありません。回答本文や解析本文は表示しません。
          </p>
          <section aria-label="現在の参加状態" className="grid gap-2">
            <h3 className="font-semibold">現在の参加状態</h3>
            {lookup.state ? (
              <RecordDetails record={lookup.state} />
            ) : (
              <p>
                参加状態の記録はありません。PIDと対象環境を確認してください。
              </p>
            )}
          </section>
          <RecordList
            title="同意・撤回・復旧許可の履歴"
            records={lookup.events}
          />
          <DocumentReissueForm
            pseudonym={lookup.pseudonym}
            records={lookup.events}
          />
          <RecordList title="解析試行の履歴" records={lookup.attempts} />
          <RecordList
            title="解析完了・アンケート提出の記録"
            records={lookup.questionnaires}
          />
          {lookup.state && (
            <ParticipationRecoveryForm pseudonym={lookup.pseudonym} />
          )}
        </div>
      )}
    </div>
  )
}

"use client"

import { useActionState } from "react"
import { authorizeParticipationRecoveryAction } from "./actions-participation-recovery"
import {
  RECOVERY_LABELS,
  type RecoveryActionState,
} from "./participation-recovery-types"

export default function ParticipationRecoveryForm({
  pseudonym,
}: {
  pseudonym: string
}) {
  const [state, action, pending] = useActionState(
    async (previous: RecoveryActionState, data: FormData) => {
      try {
        return await authorizeParticipationRecoveryAction(previous, data)
      } catch {
        // Response loss must preserve the reviewed operation, including its ID.
        return {
          ...previous,
          message:
            "通信結果を確認できませんでした。時間をおいて同じ操作を再試行してください。",
        }
      }
    },
    { message: "" } as RecoveryActionState,
  )
  return (
    <form
      action={action}
      aria-label="復旧方針の選択"
      className="grid min-w-0 gap-3 p-5 wrap-anywhere"
    >
      <h3 className="text-lg font-semibold">復旧方針の選択</h3>
      <p className="text-sm">
        研究者が履歴を確認した場合に利用します。記録を残し、新しい同意・メール確認に一度だけ適用します。解析本文は復元しません。初回アンケートへの復旧では元の解析に回答を関連付けます。
      </p>
      <p className="text-sm">
        初回アンケートが受理されると初回フローは完了し、継続利用に進めます。復旧では過去の完了・表示記録を補完しません。
      </p>
      {state.review ? (
        <>
          <p>PID: {state.review.pseudonym}</p>
          <p>
            現在の参加区分:{" "}
            {state.review.questionnaireKind === "follow-up" ? "継続" : "初回"}
          </p>
          <p>復旧先: {RECOVERY_LABELS[state.review.destination]}</p>
          <p>
            参加状態: {state.review.status} ／ 対象解析:{" "}
            {state.review.analysisId ?? "なし"}
          </p>
          <p>
            完了日時:{" "}
            {state.review.completedAt === null
              ? "記録なし"
              : new Date(state.review.completedAt).toLocaleString("ja-JP")}
          </p>
          <p>
            表示許可日時:{" "}
            {state.review.presentedAt === null
              ? "記録なし"
              : new Date(state.review.presentedAt).toLocaleString("ja-JP")}{" "}
            {state.review.destination === "initial-survey"
              ? "／ 回答: 未回答"
              : ""}
          </p>
          <p>理由: {state.review.reason}</p>
          <p>
            既存の未使用許可を置き換え、再認証を要求します。参加者への確認と履歴の確認を済ませてください。
          </p>
          {Object.entries(state.review)
            .filter(([key]) =>
              [
                "pseudonym",
                "destination",
                "analysisId",
                "reason",
                "fingerprint",
                "recoveryId",
              ].includes(key),
            )
            .map(([key, value]) => (
              <input
                key={key}
                type="hidden"
                name={key}
                value={String(value ?? "")}
              />
            ))}
          <button
            name="confirm"
            value="yes"
            disabled={pending}
            type="submit"
            className="rounded border p-2"
          >
            確認して復旧を許可する
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            disabled={pending}
            className="rounded border p-2"
          >
            取り消して再確認
          </button>
        </>
      ) : (
        <>
          <p>対象PID: {pseudonym}</p>
          <input type="hidden" name="pseudonym" value={pseudonym} />
          <label>
            復旧先
            <select
              name="destination"
              className="block w-full min-w-0 rounded border p-2"
            >
              {Object.entries(RECOVERY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            対象解析ID（初回アンケートの場合。省略時は現在の初回解析）
            <input
              name="analysisId"
              maxLength={256}
              className="block w-full min-w-0 rounded border p-2"
            />
          </label>
          <label>
            許可理由（文書や解析本文を含めないでください）
            <textarea
              name="reason"
              required
              maxLength={1000}
              className="block w-full min-w-0 rounded border p-2"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded border p-2"
          >
            {pending ? "確認中…" : "対象を確認する"}
          </button>
        </>
      )}
      <p role="status">{state.message}</p>
    </form>
  )
}

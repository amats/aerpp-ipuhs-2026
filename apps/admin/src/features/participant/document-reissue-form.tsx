"use client"
import { useState } from "react"
import { reissueParticipantDocumentAction } from "./actions-document-reissue"
import type { RecoveryRecord } from "./participation-recovery-lookup-types"

export default function DocumentReissueForm({
  pseudonym,
  records,
}: {
  pseudonym: string
  records: RecoveryRecord[]
}) {
  const eligible = records.filter(
    (record) =>
      record.eventType === "consent" || record.eventType === "withdrawal",
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  return (
    <form
      className="grid gap-3 rounded border p-3"
      aria-label="書類の再発行"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        setBusy(true)
        try {
          const result = await reissueParticipantDocumentAction({
            pseudonym,
            recordId: form.get("recordId"),
            name: form.get("name"),
          })
          if (result.ok !== true) {
            setMessage(result.error)
            return
          }
          const bytes = Uint8Array.from(
            atob(result.contentBase64),
            (character) => character.charCodeAt(0),
          )
          const url = URL.createObjectURL(
            new Blob([bytes], { type: "application/pdf" }),
          )
          const anchor = document.createElement("a")
          anchor.href = url
          anchor.download = result.filename
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          setMessage("書類を生成しました。参加者への送付は別途行ってください。")
        } catch {
          setMessage("再発行に失敗しました。再試行してください。")
        } finally {
          setBusy(false)
        }
      }}
    >
      <h3 className="font-semibold">書類の再発行</h3>
      <p className="text-sm">
        参加者を別途確認してから利用してください。生成の日時・担当者・成否を記録します。研究参加の状態は変更しません。
      </p>
      <fieldset disabled={busy || eligible.length === 0} className="grid gap-3">
        <label>
          受付記録
          <select name="recordId" className="block w-full rounded border p-2">
            {eligible.map((record) => (
              <option key={record.id} value={record.id}>
                {record.eventType === "consent" ? "同意" : "撤回"} ／{" "}
                {record.time === null
                  ? "日時不明"
                  : new Date(record.time).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}{" "}
                ／ {record.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          書類
          <select name="name" className="block w-full rounded border p-2">
            <option value="receipt">選択した同意書・撤回書</option>
            <option value="explanation">当時の説明文書</option>
            <option value="plan">当時の研究計画書</option>
          </select>
        </label>
        <button type="submit" className="rounded border p-2">
          {busy ? "生成中…" : "再発行してダウンロード"}
        </button>
      </fieldset>
      {message !== "" && <p role="status">{message}</p>}
    </form>
  )
}

"use client"

import { useActionState, useState } from "react"
import { verifyParticipantDocumentAction } from "./actions-document-verification"
import type { DocumentVerificationState } from "./document-verification-types"

export default function DocumentVerificationForm() {
  const [state, action, pending] = useActionState(
    verifyParticipantDocumentAction,
    { message: "" } as DocumentVerificationState,
  )
  const [requestId, setRequestId] = useState(0)
  const [input, setInput] = useState({
    email: "",
    date: "",
    purpose: "consent",
    did: "",
    version: "",
    sha256: "",
  })
  function updateInput(name: keyof typeof input, value: string) {
    setInput((previous) => ({ ...previous, [name]: value }))
    setRequestId((id) => id + 1)
  }
  const result =
    pending !== true && state.requestId === String(requestId)
      ? state
      : undefined
  return (
    <form
      action={action}
      onReset={(event) => {
        // The displayed binding must still describe the returned match.
        event.preventDefault()
      }}
      aria-label="PDFのDID照合"
      className="grid w-full min-w-0 max-w-2xl gap-3 p-5"
    >
      <h2 className="text-lg font-semibold">PDFのDID照合</h2>
      <p className="text-sm">
        PDFに記載されたメールアドレス・日本時間の日付・文書種別・文書セットSHA-256とDIDの対応を確認します。保存原本と受付記録も別々に確認します。
      </p>
      <fieldset disabled={pending} className="grid min-w-0 gap-3">
        <label>
          メールアドレス
          <input
            type="email"
            name="email"
            value={input.email}
            onChange={(event) => updateInput("email", event.target.value)}
            required
            autoComplete="off"
            className="block w-full min-w-0 rounded border p-2"
          />
        </label>
        <label>
          PDFの日付（日本時間）
          <input
            type="date"
            name="date"
            value={input.date}
            onChange={(event) => updateInput("date", event.target.value)}
            required
            className="block w-full min-w-0 rounded border p-2"
          />
        </label>
        <label>
          文書種別
          <select
            name="purpose"
            value={input.purpose}
            onChange={(event) => updateInput("purpose", event.target.value)}
            className="block w-full min-w-0 rounded border p-2"
          >
            <option value="consent">同意書</option>
            <option value="withdrawal">同意撤回書</option>
          </select>
        </label>
        <label>
          DID
          <input
            name="did"
            value={input.did}
            onChange={(event) => updateInput("did", event.target.value)}
            required
            maxLength={42}
            autoComplete="off"
            spellCheck={false}
            className="block w-full min-w-0 rounded border p-2"
          />
        </label>
        <label>
          文書セットのバージョン
          <input
            name="version"
            value={input.version}
            onChange={(event) => updateInput("version", event.target.value)}
            placeholder="1.0"
            required
            maxLength={32}
            className="block w-full min-w-0 rounded border p-2"
          />
        </label>
        <label>
          文書セットSHA-256
          <input
            name="sha256"
            value={input.sha256}
            onChange={(event) => updateInput("sha256", event.target.value)}
            required
            minLength={64}
            maxLength={64}
            spellCheck={false}
            className="block w-full min-w-0 rounded border p-2"
          />
        </label>
        <input type="hidden" name="requestId" value={requestId} />
        <button type="submit" className="rounded border p-2">
          {pending ? "照合中…" : "DIDを照合する"}
        </button>
      </fieldset>
      {result && (
        <div role="status">
          <p>{result.message}</p>
          {result.matched === true && (
            <>
              <p>
                保存原本：
                {result.archiveVerified === true
                  ? "ハッシュ・バージョン一致"
                  : "確認できませんでした"}
              </p>
              <p>
                受付記録：
                {result.receiptMatched === true
                  ? "該当記録あり"
                  : result.receiptMatched === false
                    ? "該当記録なし"
                    : "確認できませんでした"}
              </p>
            </>
          )}
          {result.pseudonym && (
            <p className="wrap-anywhere">履歴照会用PID: {result.pseudonym}</p>
          )}
        </div>
      )}
      {state.message !== "" && !state.requestId && (
        <p role="status">{state.message}</p>
      )}
    </form>
  )
}

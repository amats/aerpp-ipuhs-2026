"use client"

import type {
  InformationRecord,
  InformationTarget,
} from "@aerpp/firestore/information-types"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import CardSection from "@/ui/card-section"
import {
  deleteInformationAction,
  saveInformationAction,
} from "./actions-information"
import { useInformationDraft } from "./information-draft-provider"
import { formatInformationTime, parseInformationTime } from "./information-time"
import type { InformationActionResult } from "./information-types"

const INPUT_CLASS_NAME =
  "min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-transparent p-2"
const BUTTON_CLASS_NAME =
  "min-h-11 w-fit rounded-lg border border-slate-400 px-4 py-2 font-semibold disabled:opacity-50"

export default function InformationManager({
  records,
  now,
}: {
  records: InformationRecord[] | null
  now: string
}) {
  const router = useRouter()
  const listUnavailable = records === null
  const [transitionPending, startTransition] = useTransition()
  const {
    draft,
    isDirty,
    updateDraft,
    replaceDraft,
    resetDraft,
    confirmDiscard,
    message,
    setMessage,
    operationPending,
    beginOperation,
    finishOperation,
  } = useInformationDraft()
  const pending = transitionPending || operationPending
  const { editing, editingConflict, content, tone, expireAt, timeZone } = draft
  const latestRecord = editing
    ? records?.find((record) => record.id === editing.id)
    : undefined
  const versionChanged = Boolean(
    editing &&
      latestRecord &&
      (editing.version.seconds !== latestRecord.version.seconds ||
        editing.version.nanoseconds !== latestRecord.version.nanoseconds),
  )
  const needsReview = Boolean(
    editing && (editingConflict || !latestRecord || versionChanged),
  )
  const [deleting, setDeleting] = useState<InformationTarget | null>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (message?.kind !== "error" && !listUnavailable) return
    messageRef.current?.focus({ preventScroll: true })
    messageRef.current?.scrollIntoView({ block: "center", behavior: "instant" })
  }, [message, listUnavailable])
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    contentRef.current?.focus({ preventScroll: true })
    contentRef.current?.scrollIntoView({ block: "center", behavior: "instant" })
  }, [editing])

  function resetForm() {
    resetDraft()
  }

  function run(
    operation: () => Promise<InformationActionResult>,
    onSuccess: () => void,
    onConflict?: () => void,
  ) {
    if (!beginOperation()) return
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await operation()
        if (result.ok === true) {
          onSuccess()
          setMessage({ text: "操作が完了しました。", kind: "success" })
          router.refresh()
        } else {
          setMessage({ text: result.message, kind: "error" })
          if (result.reason === "conflict") {
            onConflict?.()
            router.refresh()
          }
        }
      } catch {
        setMessage({
          text: "操作結果を確認できませんでした。再送信する前に一覧を再読み込みしてください。",
          kind: "error",
        })
      } finally {
        finishOperation()
      }
    })
  }

  function edit(record: InformationRecord) {
    if (!confirmDiscard()) return
    let localExpiry = ""
    try {
      localExpiry = formatInformationTime(record.expireAt, timeZone)
    } catch {
      setMessage({
        text: "タイムゾーンを確認してから編集してください。",
        kind: "error",
      })
      return
    }
    replaceDraft({
      editing: { id: record.id, version: record.version },
      editingConflict: false,
      content: record.content,
      tone: record.tone,
      expireAt: localExpiry,
      timeZone,
    })
    setMessage(null)
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:items-start">
      <CardSection className="xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">お知らせ管理</h2>
          <button
            type="button"
            className={BUTTON_CLASS_NAME}
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            一覧を再読み込み
          </button>
        </div>
        <div className="max-w-3xl space-y-2 text-sm">
          <p>お知らせはこの環境の全サーバーで共通です。</p>
          <p className="text-sm">
            Web
            への反映は次回の取得時です。閉じられたお知らせは編集しても再表示されません。再告知には新規追加を使ってください。
          </p>
          <p className="text-sm">
            有効期限を過ぎても、削除されるまで表示される場合があります。一覧の日時は
            UTC です。入力には任意のタイムゾーンを指定できます。
          </p>
        </div>
        {(message || listUnavailable) && (
          <p
            ref={messageRef}
            role={
              listUnavailable || message?.kind === "error" ? "alert" : "status"
            }
            tabIndex={-1}
            className="rounded border border-current p-3"
          >
            {listUnavailable
              ? "お知らせを取得できませんでした。入力内容は保持しています。権限・接続を確認し、一覧を再読み込みしてください。"
              : message?.text}
          </p>
        )}
      </CardSection>
      <CardSection>
        <h2 className="text-xl font-bold">
          {editing ? "お知らせを編集" : "お知らせを追加"}
        </h2>
        {isDirty && (
          <p role="status" className="text-sm">
            未保存の変更があります。管理画面内を移動して戻っても、入力内容は保持されます。再読み込みやタブを閉じると失われます。
          </p>
        )}
        {needsReview && (
          <section
            aria-labelledby="information-conflict-heading"
            className="space-y-3 rounded-lg border border-amber-500 p-3"
          >
            <h3 id="information-conflict-heading" className="font-semibold">
              最新版の確認
            </h3>
            <p>入力中の内容は下のフォームに保持しています。</p>
            {listUnavailable ? (
              <p>
                最新版を取得できるまで保存できません。入力内容を残したまま、一覧の再読み込みをお試しください。
              </p>
            ) : latestRecord ? (
              <>
                <p>現在保存されている本文：</p>
                <p className="max-h-72 overflow-auto whitespace-pre-wrap wrap-anywhere">
                  {latestRecord.content}
                </p>
                <p className="text-sm">
                  種別: {latestRecord.tone} / 有効期限（UTC）:{" "}
                  {latestRecord.expireAt}
                </p>
                {versionChanged ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className={BUTTON_CLASS_NAME}
                      disabled={pending}
                      onClick={() => {
                        updateDraft({
                          editing: {
                            id: latestRecord.id,
                            version: latestRecord.version,
                          },
                          editingConflict: false,
                        })
                        setMessage(null)
                      }}
                    >
                      最新版を確認し、入力中の内容で編集を続ける
                    </button>
                    <button
                      type="button"
                      className={BUTTON_CLASS_NAME}
                      disabled={pending}
                      onClick={() => edit(latestRecord)}
                    >
                      入力を破棄して最新版を読み込む
                    </button>
                  </div>
                ) : (
                  <p>
                    最新版を取得しています。表示が変わらない場合は一覧を再読み込みしてください。
                  </p>
                )}
              </>
            ) : (
              <p>
                このお知らせは削除されています。変更は保存できません。必要な入力内容をコピーしてから編集を取り消してください。
              </p>
            )}
          </section>
        )}
        <form
          className="w-full min-w-0 max-w-2xl"
          onReset={(event) => {
            // Only resetDraft clears accepted or explicitly discarded input.
            event.preventDefault()
          }}
          action={() => {
            if (needsReview || listUnavailable) return
            const date = parseInformationTime(expireAt, timeZone)
            if (date.ok === false) {
              setMessage({ text: date.message, kind: "error" })
              return
            }
            run(
              () =>
                saveInformationAction(editing, {
                  content,
                  tone,
                  expireAt: date.iso,
                }),
              resetForm,
              () => updateDraft({ editingConflict: true }),
            )
          }}
        >
          <fieldset disabled={pending} className="min-w-0 space-y-4">
            <div>
              <label className="block" htmlFor="information-content">
                本文
              </label>
              <textarea
                ref={contentRef}
                id="information-content"
                required
                className={INPUT_CLASS_NAME}
                rows={5}
                value={content}
                onChange={(event) =>
                  updateDraft({ content: event.target.value })
                }
              />
            </div>
            <div>
              <label className="block" htmlFor="information-tone">
                種別
              </label>
              <select
                id="information-tone"
                required
                className={INPUT_CLASS_NAME}
                value={tone}
                onChange={(event) => updateDraft({ tone: event.target.value })}
              >
                <option value="info">情報 (info)</option>
                <option value="warning">注意 (warning)</option>
                <option value="error">エラー (error)</option>
              </select>
            </div>
            <div>
              <label className="block" htmlFor="information-timezone">
                入力タイムゾーン
              </label>
              <input
                id="information-timezone"
                required
                list="information-timezones"
                className={INPUT_CLASS_NAME}
                value={timeZone}
                onChange={(event) =>
                  updateDraft({ timeZone: event.target.value.trim() })
                }
                aria-describedby="information-timezone-help"
              />
              <datalist id="information-timezones">
                {[
                  "Asia/Tokyo",
                  "UTC",
                  "America/New_York",
                  "Europe/London",
                  "Asia/Kolkata",
                  "Australia/Sydney",
                ].map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <p id="information-timezone-help" className="text-sm">
                地域名（例:
                Asia/Tokyo）を入力してください。夏時間は自動で反映されます。
                タイムゾーンを変更すると、入力中の日時を変更後の地域の時刻として扱います。
              </p>
            </div>
            <div>
              <label className="block" htmlFor="information-expiry">
                有効期限（指定タイムゾーン）
              </label>
              <input
                id="information-expiry"
                required
                type="datetime-local"
                step="0.001"
                min="0001-01-01T00:00"
                max="9999-12-31T23:59:59.999"
                className={INPUT_CLASS_NAME}
                value={expireAt}
                onChange={(event) =>
                  updateDraft({ expireAt: event.target.value })
                }
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className={BUTTON_CLASS_NAME}
                type="submit"
                disabled={needsReview || listUnavailable}
              >
                {pending ? "処理中…" : editing ? "変更を保存" : "追加"}
              </button>
              {editing && (
                <button
                  className={BUTTON_CLASS_NAME}
                  type="button"
                  onClick={() => {
                    if (confirmDiscard()) resetForm()
                  }}
                >
                  編集を取り消す
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </CardSection>
      <CardSection>
        <h2 className="text-xl font-bold">
          登録済みのお知らせ {records && `(${records.length})`}
        </h2>
        {records?.length === 0 && <p>お知らせはありません。</p>}
        {records?.map((record) => (
          <article
            key={record.id}
            className="space-y-3 border-t border-slate-300 pt-4"
          >
            <p className="break-all text-sm">
              ID: {record.id} · {record.tone}
            </p>
            <p className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word">
              {record.content}
            </p>
            <p className="text-sm">
              作成: {record.createdAt}
              <br />
              有効期限: {record.expireAt}{" "}
              {record.expireAt <= now ? "（期限切れ）" : ""}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                className={BUTTON_CLASS_NAME}
                type="button"
                disabled={pending || editing !== null}
                onClick={() => edit(record)}
              >
                編集
              </button>
              <button
                className={BUTTON_CLASS_NAME}
                type="button"
                disabled={pending}
                onClick={() =>
                  setDeleting({ id: record.id, version: record.version })
                }
              >
                削除
              </button>
            </div>
            {deleting?.id === record.id && (
              <fieldset className="space-y-2" aria-label="削除の確認">
                <p>このお知らせを削除します。元に戻せません。</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    className={BUTTON_CLASS_NAME}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteInformationAction(deleting),
                        () => {
                          setDeleting(null)
                          if (editing?.id === record.id) resetForm()
                        },
                        () => setDeleting(null),
                      )
                    }
                  >
                    削除を確定
                  </button>
                  <button
                    className={BUTTON_CLASS_NAME}
                    type="button"
                    disabled={pending}
                    onClick={() => setDeleting(null)}
                  >
                    取り消す
                  </button>
                </div>
              </fieldset>
            )}
          </article>
        ))}
      </CardSection>
    </div>
  )
}

"use client"

import { useId, useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { useMessageContext } from "@/features/message/message-context-provider"

type StepStatus = "complete" | "current" | "upcoming"

const items: Array<{
  id: RootStep
  label: string
  title: string
  circle: string
  description: string
}> = [
  {
    id: RootStep.start,
    label: "Step 1",
    title: "研究の概要",
    circle: "1",
    description: "研究の目的と、このシステムでできることを確認します。",
  },
  {
    id: RootStep.explanation,
    label: "Step 2",
    title: "研究の説明",
    circle: "2",
    description: "参加前に知っておいていただきたい内容をご案内します。",
  },
  {
    id: RootStep.consent,
    label: "Step 3",
    title: "研究参加の確認",
    circle: "3",
    description: "研究への参加可否と、必要な同意の確認を行います。",
  },
  {
    id: RootStep.auth,
    label: "Step 4",
    title: "メールアドレス認証",
    circle: "4",
    description: "登録したメールアドレスの確認を済ませて次へ進みます。",
  },
  {
    id: RootStep.document,
    label: "Step 5",
    title: "書類の準備",
    circle: "5",
    description: "解析する申請書類を入力またはアップロードします。",
  },
  {
    id: RootStep.result,
    label: "Step 6",
    title: "解析結果の確認",
    circle: "6",
    description: "AIの解析結果を確認し、必要に応じて保存します。",
  },
  {
    id: RootStep.survey,
    label: "Step 7",
    title: "アンケート回答",
    circle: "7",
    description: "利用後アンケートに回答して研究協力を完了します。",
  },
  {
    id: RootStep.thanks,
    label: "Step 8",
    title: "完了",
    circle: "8",
    description: "手続きは完了です。必要に応じて再度解析を行えます。",
  },
]

const statusLabelMap: Record<StepStatus, string> = {
  complete: "完了",
  current: "進行中",
  upcoming: "未着手",
}

const circleClassByStatus: Record<StepStatus, string> = {
  complete:
    "border-(--brand-blue) bg-(--brand-blue) text-white dark:bg-blue-700",
  current:
    "border-(--brand-blue) bg-(--brand-blue)/10 text-(--brand-text) ring-2 ring-(--brand-blue)/20 dark:bg-(--brand-blue)/20",
  upcoming:
    "border-slate-300 bg-white text-slate-600 dark:border-white/20 dark:bg-slate-900 dark:text-slate-400",
}

const labelClassByStatus: Record<StepStatus, string> = {
  complete: "text-slate-700 dark:text-slate-200",
  current: "text-(--brand-text)",
  upcoming: "text-slate-600 dark:text-slate-400",
}

const itemClassByStatus: Record<StepStatus, string> = {
  complete:
    "border-slate-200/80 bg-white/86 dark:border-white/10 dark:bg-slate-950/30",
  current:
    "border-(--brand-blue)/40 bg-(--brand-blue)/[0.07] shadow-sm shadow-[rgba(22,100,183,0.12)] dark:bg-(--brand-blue)/[0.14]",
  upcoming:
    "border-slate-200/70 bg-white/66 dark:border-white/10 dark:bg-slate-950/18",
}

const RESHOW_BUTTON_CLASS =
  "inline-flex w-fit items-center justify-center rounded-full border border-(--brand-blue)/35 bg-(--brand-blue)/6 px-3 py-1.5 text-[11px] font-semibold text-(--brand-text) transition-colors hover:border-(--brand-blue)/55 hover:bg-(--brand-blue)/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) dark:border-(--brand-blue)/25 dark:bg-(--brand-blue)/12 dark:hover:border-(--brand-blue)/45 dark:hover:bg-(--brand-blue)/18"

function getStatus(index: number, activeIndex: number): StepStatus {
  if (index < activeIndex) {
    return "complete"
  }

  if (index === activeIndex) {
    return "current"
  }

  return "upcoming"
}

export default function StepProgress() {
  const { rootStep, stage } = useAppContext()
  const { resetDismissedInformationMessages, dismissedInformationMessageIds } =
    useMessageContext()

  const [isExpanded, setIsExpanded] = useState(true)
  const stepsId = useId()
  const isWithdrawnFlow = rootStep === RootStep.withdrawn

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === rootStep),
  )
  const currentItem = items[activeIndex] ?? items[0]
  const summaryLabel = `${currentItem.label} / ${items.length}`

  const isReshowButtonVisible = dismissedInformationMessageIds.length > 0

  async function handleReshowMessages() {
    try {
      await resetDismissedInformationMessages()
    } catch {
      // The provider has already restored visibility for the current page.
    }
  }

  if (isWithdrawnFlow) {
    return null
  }

  const reshowButton = isReshowButtonVisible && (
    <button
      type="button"
      className={RESHOW_BUTTON_CLASS}
      onClick={() => void handleReshowMessages()}
    >
      メッセージを再表示
    </button>
  )

  return (
    <nav
      aria-label="進行中のステップ"
      className="flex w-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/92 p-3 shadow-sm shadow-slate-200/35 backdrop-blur sm:p-4 dark:border-white/10 dark:bg-slate-900/70 dark:shadow-black/20"
    >
      {stage !== Stage.followUp ? (
        <>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="sr-only">進行状況</h2>
            <p className="min-w-0 flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {currentItem.title}
            </p>
            <span className="inline-flex w-fit items-center rounded-full bg-(--brand-blue)/10 px-2.5 py-1 text-[11px] font-semibold text-(--brand-text) dark:bg-(--brand-blue)/20">
              {summaryLabel}
            </span>
            <button
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-(--brand-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) sm:w-auto dark:border-white/20"
              aria-expanded={isExpanded}
              aria-controls={stepsId}
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              {isExpanded ? "全ステップを閉じる" : "全ステップを表示"}
            </button>
            {reshowButton}
          </div>
          <p className="sr-only" aria-live="polite">
            現在の進行状況は{summaryLabel}、{currentItem.title}です。
          </p>

          <ol
            id={stepsId}
            className={`${isExpanded ? "grid" : "hidden"} grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-8`}
          >
            {items.map((item, index) => {
              const status = getStatus(index, activeIndex)

              return (
                <li
                  key={item.id}
                  aria-current={status === "current" ? "step" : undefined}
                  aria-label={`${item.label}: ${item.title}、${statusLabelMap[status]}`}
                  className={`flex min-w-0 items-center rounded-xl border px-2 py-3 transition-colors duration-200 ${itemClassByStatus[status]}`}
                >
                  <div className="flex min-w-0 items-center gap-2 lg:flex-col lg:items-start">
                    <span
                      aria-hidden
                      className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border text-[10px] font-semibold ${circleClassByStatus[status]}`}
                    >
                      {status === "complete" ? "✓" : item.circle}
                    </span>
                    <div className="min-w-0" aria-hidden="true">
                      <p
                        className={`text-[10px] font-semibold tracking-[0.14em] uppercase ${labelClassByStatus[status]}`}
                      >
                        {item.label}
                      </p>
                      <p className="min-h-[2.6em] text-[12px] leading-tight font-semibold text-slate-900 dark:text-slate-100">
                        {item.title}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="hidden text-[10px] font-semibold tracking-[0.2em] text-(--brand-text) uppercase sm:block">
              Follow up Session
            </p>
            <div className="flex min-w-0 flex-col gap-1 sm:mt-1 sm:flex-row sm:items-baseline sm:gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                繰り返し解析を行うことができます。気がついたことがあれば、解析後のアンケートにご記入ください。
              </p>
            </div>
          </div>
          <div className="flex justify-start sm:justify-end">
            {reshowButton}
          </div>
        </div>
      )}
    </nav>
  )
}

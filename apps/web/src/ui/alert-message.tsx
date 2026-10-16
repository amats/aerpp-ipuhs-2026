import type { ReactNode, Ref } from "react"
import { AlertTone } from "@/ui/alert-tone"

const toneClassMap: Record<AlertTone, string> = {
  [AlertTone.info]:
    "border-(--brand-blue)/15 bg-linear-to-br from-white via-(--brand-blue)/[0.035] to-(--brand-blue)/8 text-slate-800 dark:border-(--brand-blue)/20 dark:bg-linear-to-br dark:from-slate-900/80 dark:via-slate-900/90 dark:to-(--brand-blue)/18 dark:text-slate-100",
  [AlertTone.success]:
    "border-emerald-300/45 bg-linear-to-br from-white via-emerald-50 to-emerald-100/80 text-emerald-950 dark:border-emerald-400/35 dark:bg-linear-to-br dark:from-emerald-950/55 dark:via-emerald-950/70 dark:to-emerald-900/75 dark:text-emerald-50",
  [AlertTone.warning]:
    "border-amber-300/45 bg-linear-to-br from-white via-amber-50 to-amber-100/80 text-amber-950 dark:border-amber-400/35 dark:bg-linear-to-br dark:from-amber-950/55 dark:via-amber-950/70 dark:to-amber-900/75 dark:text-amber-50",
  [AlertTone.error]:
    "border-red-300/45 bg-linear-to-br from-white via-red-50 to-red-100/80 text-red-950 dark:border-red-400/35 dark:bg-linear-to-br dark:from-red-950/55 dark:via-red-950/70 dark:to-red-900/75 dark:text-red-50",
}

const toneSymbolClassMap: Record<AlertTone, string> = {
  [AlertTone.info]:
    "border-(--brand-blue)/20 bg-(--brand-blue)/12 text-(--brand-text) shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-(--brand-blue)/35 dark:bg-(--brand-blue)/22 dark:text-blue-100 dark:shadow-none",
  [AlertTone.success]:
    "border-emerald-400/45 bg-emerald-200/80 text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-emerald-400/40 dark:bg-emerald-800/70 dark:text-emerald-50 dark:shadow-none",
  [AlertTone.warning]:
    "border-amber-400/45 bg-amber-200/80 text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-amber-400/40 dark:bg-amber-800/70 dark:text-amber-50 dark:shadow-none",
  [AlertTone.error]:
    "border-red-400/45 bg-red-200/80 text-red-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-red-400/40 dark:bg-red-800/70 dark:text-red-50 dark:shadow-none",
}

function AlertMessage({
  children,
  tone = AlertTone.info,
  className,
  compact = false,
  id,
  role,
  ref,
  onDismiss,
}: {
  children: ReactNode
  tone?: AlertTone
  className?: string
  compact?: boolean
  id?: string
  role?: "alert" | "status"
  ref?: Ref<HTMLElement>
  onDismiss?: () => void | Promise<void>
}) {
  const composedClassName = [
    "flex items-start border shadow-sm shadow-slate-200/35 backdrop-blur-sm dark:shadow-black/20",
    compact
      ? "gap-2.5 rounded-xl px-2.5 py-1.5 text-[11px]"
      : "gap-3 rounded-2xl px-4 py-3 text-sm",
    toneClassMap[tone],
    className,
  ]
    .filter(Boolean)
    .join(" ")

  async function handleDismissClick() {
    await onDismiss?.()
  }

  return (
    <section
      ref={ref}
      id={id}
      tabIndex={-1}
      className={composedClassName}
      role={role ?? (tone === AlertTone.error ? "alert" : "status")}
      aria-live={tone === AlertTone.error ? "assertive" : "polite"}
    >
      <div
        data-tone-symbol={tone}
        className={[
          "flex shrink-0 items-center justify-center rounded-full border shadow-sm",
          compact ? "h-4.5 w-4.5" : "h-6 w-6",
          toneSymbolClassMap[tone],
        ].join(" ")}
        aria-hidden
      >
        <ToneSymbol tone={tone} compact={compact} />
      </div>
      <p
        className={`min-w-0 pt-0.5 wrap-anywhere ${compact ? "leading-snug" : "leading-relaxed"}`}
      >
        {children}
      </p>
      {onDismiss && (
        <div className="ml-auto shrink-0">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-current transition-colors hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:hover:bg-white/10"
            onClick={() => void handleDismissClick()}
            aria-label="閉じる"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}
              aria-hidden
            >
              <title>閉じる</title>
              <path d="M4 4 12 12" />
              <path d="M12 4 4 12" />
            </svg>
          </button>
        </div>
      )}
    </section>
  )
}

function ToneSymbol({ tone, compact }: { tone: AlertTone; compact: boolean }) {
  const iconClassName = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"

  if (tone === AlertTone.success) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName}
      >
        <title>Success</title>
        <path d="M3.5 8.5 6.5 11.5 12.5 5.5" />
      </svg>
    )
  }

  if (tone === AlertTone.error) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName}
      >
        <title>Error</title>
        <path d="M8 4.25v4.5" />
        <path d="M8 11.75h.01" />
      </svg>
    )
  }

  if (tone === AlertTone.warning) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName}
      >
        <title>Warning</title>
        <path d="M8 3.5 12.75 12.5H3.25L8 3.5Z" />
        <path d="M8 6.5v2.75" />
        <path d="M8 10.75h.01" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={iconClassName}
    >
      <title>Info</title>
      <path d="M8 7v4" />
      <path d="M8 4.25h.01" />
    </svg>
  )
}

AlertMessage.displayName = "AlertMessage"

export default AlertMessage

import type { KeyboardEventHandler, Ref } from "react"

export default function DocumentTabChip({
  documentKey,
  title,
  graphemeCount,
  isActive,
  tabId,
  panelId,
  tabIndex,
  onSelect,
  onKeyDown,
  ref,
}: {
  documentKey: string
  title: string
  graphemeCount: number
  isActive: boolean
  tabId: string
  panelId: string
  tabIndex: number
  onSelect: (key: string) => void
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>
  ref?: Ref<HTMLButtonElement>
}) {
  function handleSelect() {
    onSelect(documentKey)
  }

  return (
    <button
      ref={ref}
      type="button"
      id={tabId}
      aria-selected={isActive}
      aria-controls={panelId}
      role="tab"
      tabIndex={tabIndex}
      onClick={handleSelect}
      onKeyDown={onKeyDown}
      className={`group flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue) ${
        isActive
          ? "border-(--brand-blue) bg-(--brand-blue)/10 text-(--brand-text) forced-colors:underline forced-colors:decoration-2 forced-colors:underline-offset-4"
          : "border-slate-200 text-slate-600 hover:border-(--brand-blue)/40 hover:text-(--brand-text) dark:border-white/20 dark:text-slate-300 dark:hover:text-(--brand-text)"
      }`}
    >
      <span className="min-w-0 wrap-anywhere">{title}</span>
      <span className="shrink-0 text-xs font-normal text-slate-600 dark:text-slate-300 group-hover:text-(--brand-text) group-focus-within:text-(--brand-text)">
        {graphemeCount.toLocaleString()} 字
      </span>
    </button>
  )
}

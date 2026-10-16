"use client"

import { type ReactNode, useId, useState } from "react"

export function AppReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="min-h-11 shrink-0 rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      リロード
    </button>
  )
}

export function AppHeaderMenu({ children }: { children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const menuId = useId()

  return (
    <div className="min-w-0 border-t border-white/20 pt-3">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={menuId}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="min-h-11 w-full rounded-lg border border-white/25 px-3 py-2 text-sm font-semibold hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
      >
        {isExpanded ? "メニューを閉じる" : "メニュー・環境情報"}
      </button>
      <div
        id={menuId}
        className={`${isExpanded ? "flex" : "hidden"} mt-3 min-w-0 flex-col gap-3 lg:mt-0 lg:flex lg:flex-row lg:flex-wrap lg:items-start lg:justify-between`}
      >
        {children}
      </div>
    </div>
  )
}

"use client"

import { uiClassName } from "@/ui/ui-styles"

export default function ReloadPageButton({
  className,
}: {
  className?: string
} = {}) {
  return (
    <button
      type="button"
      className={uiClassName(
        "font-semibold underline underline-offset-4",
        className,
      )}
      onClick={() => window.location.reload()}
    >
      ページを再読み込み
    </button>
  )
}

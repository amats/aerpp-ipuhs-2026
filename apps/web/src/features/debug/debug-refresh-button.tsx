"use client"

import { reloadDebugPage } from "@/features/debug/debug-navigation"
import { PRIMARY_BUTTON_CLASS_NAME } from "@/ui/ui-styles"

export default function DebugRefreshButton() {
  return (
    <button
      type="button"
      className={PRIMARY_BUTTON_CLASS_NAME}
      onClick={reloadDebugPage}
    >
      再読み込み
    </button>
  )
}

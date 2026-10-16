import { formatDateInJapan } from "@/lib/date-format"
import { SUBTLE_PANEL_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function DateBadge({
  date = new Date(),
  className,
}: {
  date?: Date
  className?: string
}) {
  return (
    <div
      className={uiClassName(
        SUBTLE_PANEL_CLASS_NAME,
        "text-sm text-slate-700 dark:text-slate-100",
        className,
      )}
    >
      {formatDateInJapan(date)}
    </div>
  )
}

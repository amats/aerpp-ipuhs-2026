import type { HTMLAttributes, ReactNode } from "react"
import { BODY_TEXT_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export const CONTROL_CLASS_NAME =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-(--brand-blue) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue)/60 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"

export function FieldError({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={uiClassName(
        "text-sm font-medium wrap-anywhere text-red-700 dark:text-red-300",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  )
}

export function FieldGroup({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}) {
  return (
    <div
      className={uiClassName(
        "flex flex-col gap-1",
        BODY_TEXT_CLASS_NAME,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

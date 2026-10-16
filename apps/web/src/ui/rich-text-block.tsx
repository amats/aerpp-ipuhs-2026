import type { ReactNode } from "react"

export default function RichTextBlock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const baseClassName =
    "prose prose-sm max-w-4xl text-slate-700 dark:prose-invert dark:text-slate-100"
  const composedClassName = className
    ? `${baseClassName} ${className}`
    : baseClassName

  return <div className={composedClassName}>{children}</div>
}

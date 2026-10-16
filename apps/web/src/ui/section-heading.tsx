import type { ReactNode } from "react"
import {
  MUTED_TEXT_CLASS_NAME,
  TITLE_TEXT_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"

export default function SectionHeading({
  eyebrow,
  title,
  description,
  className,
  titleId,
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  className?: string
  titleId?: string
}) {
  const composedClassName = className
    ? `flex flex-col gap-2.5 ${className}`
    : "flex flex-col gap-2.5"

  return (
    <div className={composedClassName}>
      {eyebrow ? (
        <span className="text-xs font-semibold tracking-[0.2em] text-(--brand-text) uppercase">
          {eyebrow}
        </span>
      ) : null}
      {title ? (
        <h2
          id={titleId}
          tabIndex={-1}
          className={uiClassName(
            "text-xl font-semibold leading-tight sm:text-[1.65rem]",
            TITLE_TEXT_CLASS_NAME,
          )}
        >
          {title}
        </h2>
      ) : null}
      {description ? (
        <p
          className={uiClassName("max-w-3xl leading-7", MUTED_TEXT_CLASS_NAME)}
        >
          {description}
        </p>
      ) : null}
    </div>
  )
}

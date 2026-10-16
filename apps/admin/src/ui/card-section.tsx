import type { ReactNode } from "react"
import { CARD_SECTION_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function CardSection({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className={uiClassName(CARD_SECTION_CLASS_NAME, className)}>
      {children}
    </section>
  )
}

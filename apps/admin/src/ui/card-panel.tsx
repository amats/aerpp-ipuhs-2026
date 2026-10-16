import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react"
import { CARD_PANEL_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function CardPanel<C extends ElementType = "div">({
  children,
  className,
  as,
  ...props
}: {
  children: ReactNode
  className?: string
  as?: C
} & Omit<ComponentPropsWithoutRef<C>, "as" | "children" | "className">) {
  const Component = as ?? "div"

  return (
    <Component
      className={uiClassName(CARD_PANEL_CLASS_NAME, className)}
      {...props}
    >
      {children}
    </Component>
  )
}

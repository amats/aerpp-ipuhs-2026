import type { ComponentPropsWithRef, ReactNode } from "react"
import {
  ACTION_BUTTON_CLASS_NAME,
  PRIMARY_BUTTON_CLASS_NAME,
  SECONDARY_BUTTON_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"

type ActionButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary"
  pending?: boolean
  pendingLabel?: ReactNode
}

export default function ActionButton({
  children,
  className,
  type = "button",
  variant = "primary",
  pending = false,
  pendingLabel,
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || props["aria-busy"]}
      className={uiClassName(
        variant === "primary"
          ? PRIMARY_BUTTON_CLASS_NAME
          : SECONDARY_BUTTON_CLASS_NAME,
        ACTION_BUTTON_CLASS_NAME,
        className,
      )}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  )
}

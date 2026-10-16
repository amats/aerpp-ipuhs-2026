"use client"

import type { ChangeEventHandler, SubmitEventHandler } from "react"
import ActionButton from "@/ui/action-button"
import { CONTROL_CLASS_NAME } from "@/ui/form-field"

export default function EmailActionRow({
  email,
  onChange,
  onSubmit,
  disabled,
  readOnly = false,
  hasError = false,
  placeholder = "researcher@ipu.ac.jp",
  inputId = "email",
  ariaLabel,
  describedById,
  buttonText,
  buttonClassName,
  inputClassName,
}: {
  email: string
  onChange: ChangeEventHandler<HTMLInputElement>
  onSubmit: () => void | Promise<void>
  disabled: boolean
  readOnly?: boolean
  hasError?: boolean
  placeholder?: string
  inputId?: string
  ariaLabel?: string
  describedById?: string
  buttonText: string
  buttonClassName?: string
  inputClassName?: string
}) {
  const errorInputClassName = hasError
    ? "border-red-300 focus:border-red-400"
    : "border-slate-300 focus:border-(--brand-blue)"
  const composedInputClassName = `min-w-0 w-full ${CONTROL_CLASS_NAME} ${errorInputClassName}${
    inputClassName ? ` ${inputClassName}` : ""
  }`

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (disabled) {
      return
    }
    await onSubmit()
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      onSubmit={handleSubmit}
    >
      <input
        id={inputId}
        type="email"
        value={email}
        readOnly={readOnly}
        onChange={onChange}
        autoComplete="email"
        inputMode="email"
        aria-label={ariaLabel}
        aria-invalid={hasError ? "true" : "false"}
        aria-describedby={describedById}
        className={composedInputClassName}
        placeholder={placeholder}
      />
      <ActionButton
        type="submit"
        disabled={disabled}
        className={buttonClassName}
      >
        {buttonText}
      </ActionButton>
    </form>
  )
}

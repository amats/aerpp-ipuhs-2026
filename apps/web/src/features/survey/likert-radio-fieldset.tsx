"use client"

import { type ChangeEventHandler, useId } from "react"
import { FieldError } from "@/ui/form-field"
import { BODY_TEXT_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function LikertRadioFieldset({
  className,
  name,
  legend,
  value,
  onChange,
  onClear,
  description,
  options,
  required = false,
  errorMessage,
}: {
  className?: string
  name: string
  legend: string
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  onClear?: () => void
  description?: string[]
  options: readonly string[]
  required?: boolean
  errorMessage?: string
}) {
  const errorId = useId()

  return (
    <fieldset
      data-survey-question={name}
      className={uiClassName(
        "flex flex-col gap-2",
        BODY_TEXT_CLASS_NAME,
        className,
      )}
    >
      <legend className="font-medium">{legend}</legend>
      {errorMessage && (
        <FieldError id={errorId} className="mt-2">
          {errorMessage}
        </FieldError>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {options.map((option, index) => {
          const isSelected = value === option
          const optionClass = [
            "flex min-h-11 flex-1 items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium leading-snug transition focus-within:ring-2 focus-within:ring-(--brand-blue) focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-900",
            errorMessage
              ? "border-red-500 bg-white text-slate-700 dark:border-red-400 dark:bg-slate-900 dark:text-slate-200"
              : isSelected
                ? "border-(--brand-blue) bg-(--brand-blue)/10 text-(--brand-text) dark:border-(--brand-blue)/80 dark:bg-(--brand-blue)/20"
                : "border-slate-300 bg-white text-slate-700 hover:border-(--brand-blue)/60 hover:bg-(--brand-blue)/5 dark:border-white/20 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-(--brand-blue)/60 dark:hover:bg-(--brand-blue)/10",
          ].join(" ")

          return (
            <div key={option} className="flex flex-col gap-0.5">
              {description?.[index] ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {description[index]}
                </p>
              ) : null}
              <label className={optionClass}>
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={isSelected}
                  aria-invalid={errorMessage ? true : undefined}
                  aria-describedby={errorMessage ? errorId : undefined}
                  onChange={onChange}
                  className="h-4 w-4 shrink-0 accent-(--brand-blue) focus:outline-none"
                  required={required && index === 0}
                />
                <span>{option}</span>
              </label>
            </div>
          )
        })}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={value === ""}
          aria-label={`選択を解除（未回答に戻す）：${legend}`}
          className="flex min-h-11 max-w-full flex-wrap items-center justify-end self-end rounded-lg px-2 py-2 text-sm leading-snug text-slate-600 transition-colors enabled:hover:bg-slate-100 enabled:hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) disabled:text-slate-400 dark:text-slate-300 dark:enabled:hover:bg-white/10 dark:enabled:hover:text-white dark:disabled:text-slate-500"
        >
          <span className="underline underline-offset-4">選択を解除</span>
          <span>（未回答に戻す）</span>
        </button>
      )}
    </fieldset>
  )
}

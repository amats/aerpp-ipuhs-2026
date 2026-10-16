export function uiClassName(
  ...values: Array<string | false | null | undefined>
) {
  return values.filter(Boolean).join(" ")
}

export const MUTED_TEXT_CLASS_NAME =
  "text-sm text-slate-600 dark:text-slate-300"

export const TITLE_TEXT_CLASS_NAME = "text-slate-900 dark:text-slate-100"

const CARD_BASE_CLASS_NAME =
  "border border-slate-200/80 backdrop-blur dark:border-white/10"

export const CARD_SECTION_CLASS_NAME = uiClassName(
  CARD_BASE_CLASS_NAME,
  "flex min-w-0 flex-col gap-5 rounded-2xl bg-white/95 p-4 shadow-md shadow-slate-200/50 sm:p-6 lg:gap-6 lg:p-7",
  "dark:bg-slate-900/70 dark:shadow-black/20",
)

export const CARD_PANEL_CLASS_NAME = uiClassName(
  CARD_BASE_CLASS_NAME,
  "min-w-0 rounded-xl bg-white/90 shadow-sm shadow-slate-200/35",
  "dark:bg-slate-950/40 dark:shadow-black/20",
)

export const SOFT_BADGE_CLASS_NAME =
  "rounded-full border border-slate-200/60 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-900/60"

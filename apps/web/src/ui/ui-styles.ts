export function uiClassName(
  ...values: Array<string | false | null | undefined>
) {
  return values.filter(Boolean).join(" ")
}

export const ACTION_BUTTON_CLASS_NAME =
  "w-full shrink-0 px-6 py-3 sm:w-auto sm:min-w-48"

export const ACTION_ROW_CLASS_NAME =
  "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end"

export const PRIMARY_BUTTON_CLASS_NAME = uiClassName(
  "inline-flex items-center justify-center rounded-lg bg-(--brand-blue) px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-[rgba(22,100,183,0.16)]",
  "transition-all duration-200 hover:bg-(--brand-blue)/90 hover:shadow-md hover:shadow-[rgba(22,100,183,0.2)]",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue)/60",
  "forced-colors:border forced-colors:border-[ButtonText] disabled:forced-colors:border-[GrayText]",
  "active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-(--brand-blue) disabled:hover:shadow-sm",
  "dark:bg-blue-700 dark:hover:bg-blue-600",
)

export const BODY_TEXT_CLASS_NAME = "text-sm text-slate-700 dark:text-slate-200"

export const MUTED_TEXT_CLASS_NAME =
  "text-sm text-slate-600 dark:text-slate-300"

export const TITLE_TEXT_CLASS_NAME = "text-slate-900 dark:text-slate-100"

const CARD_BASE_CLASS_NAME =
  "border border-slate-200/80 backdrop-blur dark:border-white/10"

export const CARD_SECTION_CLASS_NAME = uiClassName(
  CARD_BASE_CLASS_NAME,
  "flex flex-col gap-5 rounded-2xl bg-white/95 p-4 shadow-md shadow-slate-200/50 sm:p-6 lg:gap-6 lg:p-7",
  "dark:bg-slate-900/70 dark:shadow-black/20",
)

export const CARD_PANEL_CLASS_NAME = uiClassName(
  CARD_BASE_CLASS_NAME,
  "rounded-xl bg-white/90 shadow-sm shadow-slate-200/35",
  "dark:bg-slate-950/40 dark:shadow-black/20",
)

export const CARD_PANEL_INTERACTIVE_CLASS_NAME = uiClassName(
  CARD_PANEL_CLASS_NAME,
  "transition-all duration-200 hover:border-(--brand-blue)/40 hover:shadow-md",
  "dark:hover:border-(--brand-blue)/60",
)

export const CARD_PANEL_ACCENT_CLASS_NAME = uiClassName(
  CARD_PANEL_CLASS_NAME,
  "bg-linear-to-br from-white to-sky-50 shadow-md",
  "border-(--brand-blue)/45 text-slate-700 dark:border-(--brand-blue)/40 dark:from-slate-900/70 dark:to-slate-900/40 dark:text-slate-100",
)

const SURFACE_PANEL_BASE_CLASS_NAME = uiClassName(
  "rounded-xl border border-slate-200/80 backdrop-blur-sm",
  "dark:border-white/10",
)

export const SURFACE_PANEL_CLASS_NAME = uiClassName(
  SURFACE_PANEL_BASE_CLASS_NAME,
  "bg-slate-50/75 dark:bg-slate-950/30",
)

export const SUBTLE_PANEL_CLASS_NAME = uiClassName(
  SURFACE_PANEL_CLASS_NAME,
  "px-4 py-3",
)

export const SOFT_BADGE_CLASS_NAME =
  "rounded-full border border-slate-200/60 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-900/60"

export const SECONDARY_BUTTON_CLASS_NAME = uiClassName(
  "rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800",
  "transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue)/60",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "dark:border-white/15 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/80",
)

import { readFileSync } from "node:fs"
import path from "node:path"
import LicenseNotices from "@/features/license/license-notices"
import ModelLicenseTerms from "@/features/license/model-license-terms"
import { LLM_CONFIG } from "@/features/llm/analysis-server-config"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import {
  CARD_PANEL_INTERACTIVE_CLASS_NAME,
  MUTED_TEXT_CLASS_NAME,
  SOFT_BADGE_CLASS_NAME,
  TITLE_TEXT_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"

function loadAppLicenseText(): string {
  return readFileSync(
    path.join(process.cwd(), "generated/licenses/LICENSE"),
    "utf8",
  )
}

export default function Page() {
  const appLicenseText = loadAppLicenseText()
  const llmLicenses = [LLM_CONFIG.license]

  return (
    <>
      <nav aria-label="ライセンスの目次" className="flex flex-wrap gap-3">
        {[
          ["app-license-title", "アプリケーション"],
          ["third-party-license-title", "第三者のライセンス"],
          ["model-license-title", "使用モデル"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-(--brand-text) hover:bg-(--brand-blue)/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) dark:border-white/20"
          >
            {label}
          </a>
        ))}
      </nav>
      <CardSection>
        <SectionHeading
          eyebrow="Official license"
          title="アプリケーションライセンス"
          titleId="app-license-title"
          description="本アプリケーションの利用条件を以下に全文掲載しています。内容をご確認のうえ、ご利用ください。"
        />
        <section
          aria-labelledby="app-license-title"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll the full license.
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) max-h-120 overflow-y-auto rounded-xl border border-slate-200/60 bg-white/95 p-4 text-sm leading-relaxed text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200"
        >
          <pre>{appLicenseText}</pre>
        </section>
      </CardSection>
      <LicenseNotices />
      <CardSection>
        <SectionHeading
          eyebrow="LLM"
          title="使用モデルのライセンス"
          titleId="model-license-title"
          description="選択中のモデルの帰属情報と利用規約です。利用・再配布の条件はリンク先の規約をご確認ください。"
        />
        <ul className="grid gap-3">
          {llmLicenses.map(({ model, provider, licenseName, link, note }) => (
            <CardPanel
              as="li"
              key={model}
              className={uiClassName(
                CARD_PANEL_INTERACTIVE_CLASS_NAME,
                "flex min-w-0 flex-col gap-2 p-4 text-sm wrap-anywhere dark:text-slate-200",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong
                  className={uiClassName("text-base", TITLE_TEXT_CLASS_NAME)}
                >
                  {model}
                </strong>
                <span
                  className={uiClassName(
                    SOFT_BADGE_CLASS_NAME,
                    "px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-300",
                  )}
                >
                  {provider}
                </span>
              </div>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-(--brand-text) underline-offset-4 hover:underline"
              >
                {licenseName}
              </a>
              <p
                className={uiClassName(
                  "text-[13px] leading-relaxed",
                  MUTED_TEXT_CLASS_NAME,
                )}
              >
                {note}
              </p>
              <ModelLicenseTerms licenseLink={link} />
            </CardPanel>
          ))}
        </ul>
      </CardSection>
    </>
  )
}

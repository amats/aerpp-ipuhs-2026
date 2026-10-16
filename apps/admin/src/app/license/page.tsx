import { readFileSync } from "node:fs"
import path from "node:path"
import type { Metadata } from "next"
import Link from "next/link"
import LicenseNotices from "@/features/license/license-notices"
import CardSection from "@/ui/card-section"
import MainContentLayout from "@/ui/main-content-layout"
import SectionHeading from "@/ui/section-heading"

export const metadata: Metadata = {
  title: "ライセンス",
  description:
    "AERPP管理アプリケーションと、利用しているソフトウェアのライセンス情報を確認できます。",
}
// Read the wheel notices regenerated inside the runtime image, not a build-time snapshot.
export const dynamic = "force-dynamic"

export default async function LicensePage() {
  const license = readFileSync(
    path.join(process.cwd(), "generated/licenses/LICENSE"),
    "utf8",
  )
  return (
    <MainContentLayout>
      <Link href="/dashboard" className="underline">
        管理画面に戻る
      </Link>
      <nav aria-label="ライセンスの目次" className="flex flex-wrap gap-3">
        {[
          ["app-license-title", "アプリケーション"],
          ["third-party-license-title", "第三者のライセンス"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-(--brand) hover:bg-(--brand)/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand) dark:border-white/20"
          >
            {label}
          </a>
        ))}
      </nav>
      <CardSection>
        <SectionHeading
          title="アプリケーションライセンス"
          titleId="app-license-title"
        />
        <pre className="whitespace-pre-wrap wrap-break-word text-sm">
          {license}
        </pre>
      </CardSection>
      <LicenseNotices />
    </MainContentLayout>
  )
}

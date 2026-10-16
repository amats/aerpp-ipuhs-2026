import { env } from "@aerpp/config/server/admin"
import { resolveDataPurposeFilter } from "@aerpp/firestore/data-purpose-types"
import AppFooter from "@/features/app-shell/app-footer"
import AppHeader from "@/features/app-shell/app-header"
import { APP_PAGES, type AppPath } from "@/features/app-shell/app-navigation"
import { getConfiguredServerId } from "@/features/monitoring/participant-records"
import { requireAdminSession } from "@/lib/auth"
import { APP_VERSION } from "@/lib/version"
import MainContentLayout from "@/ui/main-content-layout"
import DataPurposeSelect from "./data-purpose-select"

export default async function AppShell({
  children,
  className,
  currentPath,
  searchParams,
}: {
  children: React.ReactNode
  className?: string
  currentPath: AppPath
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireAdminSession(currentPath)
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const selectedServerId = getConfiguredServerId()
  const dataPurpose = resolveDataPurposeFilter(
    resolvedSearchParams?.dataPurpose,
  )

  return (
    <>
      <AppHeader
        currentPath={currentPath}
        email={session.user?.email ?? null}
        pageTitle={
          APP_PAGES.find((page) => page.href === currentPath)?.title ??
          "管理画面"
        }
        selectedServerId={selectedServerId}
        receptionExpiresAt={env.supportReceptionExpiresAt}
        backendStopsAt={env.supportBackendStopsAt}
        dataPurpose={dataPurpose}
        adminAuthBypassEnabled={env.adminAuthBypassEnabled}
      />
      <MainContentLayout className={className}>
        {["/dashboard", "/participant", "/survey", "/updates", "/log"].includes(
          currentPath,
        ) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <DataPurposeSelect selected={dataPurpose} />
            <div className="min-w-0 text-sm">
              <p>
                {currentPath === "/log" || currentPath === "/dashboard"
                  ? "利用・参加・回答の表示を絞り込みます。運用ログ・メンテナンス・お知らせは環境全体が対象です。"
                  : "画面表示のみを絞り込みます。"}{" "}
                データ出力は全区分が対象です。
              </p>
              <details className="max-w-3xl">
                <summary className="w-fit min-h-11 cursor-pointer rounded py-3 text-(--brand) underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
                  出力範囲について
                </summary>
                <p>
                  データ出力にはテスト・未分類を含む全区分が含まれるため、解析対象はオフラインで選定してください。
                </p>
              </details>
            </div>
          </div>
        )}
        {children}
      </MainContentLayout>
      <AppFooter
        appVersion={APP_VERSION}
        currentPath={currentPath}
        dataPurpose={dataPurpose}
      />
    </>
  )
}

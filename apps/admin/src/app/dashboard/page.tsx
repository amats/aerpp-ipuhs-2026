import AppShell from "@/features/app-shell/app-shell"
import Dashboard from "../../features/dashboard/dashboard"

export default async function DashboardRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/dashboard" searchParams={searchParams}>
      <Dashboard searchParams={searchParams} />
    </AppShell>
  )
}

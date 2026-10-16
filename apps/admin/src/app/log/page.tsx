import AppShell from "@/features/app-shell/app-shell"
import OperationalStatus from "@/features/log/operational-status"

export default async function OperationalStatusRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/log" searchParams={searchParams}>
      <OperationalStatus searchParams={searchParams} />
    </AppShell>
  )
}

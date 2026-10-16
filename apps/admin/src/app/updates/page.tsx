import AppShell from "@/features/app-shell/app-shell"
import ParticipantActivity from "../../features/updates/participant-activity"

export default async function ActivityRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/updates" searchParams={searchParams}>
      <ParticipantActivity searchParams={searchParams} />
    </AppShell>
  )
}

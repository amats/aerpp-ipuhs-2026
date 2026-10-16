import AppShell from "@/features/app-shell/app-shell"
import Participant from "../../features/participant/participant"

export default async function ParticipantRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/participant" searchParams={searchParams}>
      <Participant searchParams={searchParams} />
    </AppShell>
  )
}

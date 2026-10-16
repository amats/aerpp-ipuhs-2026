import AppShell from "@/features/app-shell/app-shell"
import Information from "@/features/information/information"
export default async function InformationRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/information" searchParams={searchParams}>
      <Information />
    </AppShell>
  )
}

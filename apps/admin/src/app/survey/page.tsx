import AppShell from "@/features/app-shell/app-shell"
import SurveyResults from "../../features/survey/survey-results"

export default async function SurveyRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <AppShell currentPath="/survey" searchParams={searchParams}>
      <SurveyResults searchParams={searchParams} />
    </AppShell>
  )
}

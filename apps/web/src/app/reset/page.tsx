import { env } from "@aerpp/config/server/web"
import { notFound } from "next/navigation"
import ResetPage from "@/features/reset/reset-page"

export default function Page() {
  if (env.debugPagesEnabled !== true) notFound()
  return <ResetPage />
}

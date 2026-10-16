import { env } from "@aerpp/config/server/web"
import DownloadPage from "@/features/download/download-page"

export default function Page() {
  return <DownloadPage contactEmail={env.supportContactEmail} />
}

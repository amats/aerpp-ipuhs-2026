import { env } from "@aerpp/config/server/web"
import WithdrawPage from "@/features/withdraw/withdraw-page"

export default function Page() {
  return <WithdrawPage contactEmail={env.supportContactEmail} />
}

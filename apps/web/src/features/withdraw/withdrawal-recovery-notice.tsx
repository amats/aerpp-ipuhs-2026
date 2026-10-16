import Link from "next/link"
import AlertMessage from "@/ui/alert-message"
import WithdrawalDataNotice from "./withdrawal-data-notice"

export default function WithdrawalRecoveryNotice({
  contactEmail,
}: {
  contactEmail: string
}) {
  return (
    <AlertMessage>
      <span className="block">
        撤回後に再開するには、研究責任者による復旧許可が必要です。誤って撤回した場合や再開をご希望の場合は、次の連絡先へご連絡ください。
      </span>
      <a href={`mailto:${contactEmail}`} className="break-all underline">
        {contactEmail}
      </a>
      <span className="mt-3 block">
        撤回後も、このブラウザーのセッションが維持されている間は、同意履歴・関連書類画面から同意書・同意撤回書・研究計画書・説明文書を取得できます。
      </span>
      <Link href="/download" className="mt-2 block underline">
        同意履歴・関連書類（同意撤回書の控え）
      </Link>
      <WithdrawalDataNotice />
    </AlertMessage>
  )
}

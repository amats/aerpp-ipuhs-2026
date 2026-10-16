import type { AppContextState } from "@/features/app-context/app-context-types"
import ReloadPageButton from "@/features/session/reload-page-button"
import AlertMessage from "@/ui/alert-message"

export default function WithdrawalCleanupStatus({
  status = "unconfirmed",
  autoRefresh = false,
  checking = false,
}: {
  status: AppContextState["withdrawalCleanupStatus"]
  autoRefresh?: boolean
  checking?: boolean
}) {
  const complete = status === "complete"
  return (
    <AlertMessage tone={complete ? "success" : "warning"}>
      <strong className="block text-lg font-semibold sm:text-xl">
        {complete
          ? "データの消去が完了しました"
          : status === "pending"
            ? "データの消去はまだ完了していません"
            : status === "stateFailed"
              ? "撤回状態を保存できませんでした"
              : status === "localFailed"
                ? "ブラウザー内の一時データを消去できませんでした"
                : "データの消去完了は未確認です"}
      </strong>
      <span className="mt-2 block text-base leading-7">
        {complete
          ? "サーバーの対象データと、ブラウザー内の一時データの消去を確認しました。ブラウザーを閉じて構いません。"
          : status === "localFailed"
            ? "サーバーの対象データの消去は完了しました。ブラウザーの保存設定を確認し、「データ削除の再試行」でブラウザー内の一時データの消去を再試行してください。繰り返し失敗する場合は、ページを再読み込みしてください。"
            : status === "stateFailed"
              ? "撤回申請は受理されています。撤回状態の保存と消去状態の確認を再試行してください。再度の参加申請は不要です。"
              : status === "pending"
                ? autoRefresh
                  ? "撤回申請は受理されています。参加を再開せず、この画面でデータの消去を自動で再試行・確認します。メールアドレスの再入力は不要です。"
                  : "撤回申請は受理されています。「データ削除の再試行」で消去状態を確認してください。メールアドレスの再入力は不要です。"
                : autoRefresh
                  ? "この画面で消去状態を自動確認します。メールアドレスの再入力は不要です。"
                  : "消去状態を確認しています。確認できない場合は「データ削除の再試行」を押してください。メールアドレスの再入力は不要です。"}
        {status === "localFailed" && <ReloadPageButton />}
      </span>
      {complete && (
        <span className="mt-2 block text-base leading-7">
          同意・撤回の記録など、説明文書で保存をお伝えした情報は残ります。
        </span>
      )}
      {!complete && status !== "localFailed" && autoRefresh && (
        <span className="mt-2 block text-base leading-7">
          {checking
            ? "現在、消去状態を確認しています。"
            : "前回の確認が終わってから約30秒後に、次の自動確認を行います。"}
          消去完了までの時間はデータ量や通信状況によって異なります。画面を閉じても、受理済みの撤回は取り消されず、サーバー側で削除を継続します。
        </span>
      )}
    </AlertMessage>
  )
}

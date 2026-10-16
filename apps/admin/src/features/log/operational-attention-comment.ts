import type { OperationalGroup } from "./operational-log-types"

const CODE_COMMENTS: Record<string, string> = {
  MAIL_REAUTHORIZATION_REQUIRED:
    "メール基盤の認証更新が必要と記録されたため、認証メールを送れない可能性があります。最新の点検結果と認証状態を確認してください。",
  MAIL_DELIVERY_UNCONFIRMED:
    "メール送信の成否を確定できず、利用者が認証を進められない可能性があります。重複送信を避け、送信結果を確認してください。",
  MAIL_TEMPORARILY_UNAVAILABLE:
    "メール基盤の一時的な障害で、認証メールを送れない可能性があります。障害が続いているかを確認してください。",
  MAIL_RECIPIENT_FORBIDDEN:
    "送信先の制限によってメールが拒否されたため、正規の利用者が認証できない可能性があります。テスト用の拒否か、送信先設定の問題かを確認してください。",
  AUTHENTICATION_FAILED:
    "研究責任者認証の失敗が記録されたため、ログインできない問題の可能性があります。取消などの想定内の失敗か、継続する認証障害かを確認してください。",
  AUTHENTICATION_WARNING:
    "研究責任者認証の警告が記録されたため、認証設定やログインへの影響を確認する候補にしています。警告だけでは障害とは断定できません。",
  INVALID_CONFIGURATION:
    "設定不備が記録されたため、サービスが正常に動作しない可能性があります。対象の設定と現在の稼働状況を確認してください。",
  LISTEN_FAILED:
    "サービスの起動失敗が記録されたため、要求を受け付けられない可能性があります。現在の稼働状況を確認してください。",
  SHUTDOWN_FAILED:
    "サービスの終了処理に失敗したため、正常に切り替わっていない可能性があります。現在の稼働状況と終了時のログを確認してください。",
}

export function operationalAttentionComment(group: OperationalGroup): string {
  if (group.code !== null && Object.hasOwn(CODE_COMMENTS, group.code) === true)
    return CODE_COMMENTS[group.code]
  if (group.operation === "withdrawalCleanup")
    return "撤回データの削除処理に問題が記録され、削除が完了していない可能性があります。過去の失敗も含むため、定期メンテナンスの最新結果を確認してください。"
  if (group.operation === "mailHealth")
    return "メール基盤の定期点検に問題が記録され、認証メールを送れない可能性があります。過去の失敗も含むため、最新の点検結果を確認してください。"
  if (
    group.statusCode !== null &&
    group.statusCode >= 200 &&
    group.statusCode < 300 &&
    group.event?.endsWith(".failed") === true
  )
    return "HTTP通信は成功していますが、応答の形式・内容から正常な処理結果を確認できなかったため、確認対象にしています。サーバー側の受付結果は関連ログで確認してください。"
  if (group.statusCode === 429)
    return "要求回数の制限で正常な利用を妨げる可能性があるため、確認対象にしています。短時間のテストでも発生するため、アクセスの集中や利用者への影響を確認してください。"
  if (group.statusCode === 401 || group.statusCode === 403)
    return "認証・権限による拒否で、正規利用者のアクセス障害や不審なアクセスの可能性があるため、確認対象にしています。認証なしの確認テストでも発生します。"
  if (group.statusCode === 404)
    return "アクセス先が見つからず、リンク切れや想定外のアクセスの可能性があるため、確認対象にしています。存在しないパスへの確認テストでも発生します。"
  if (group.statusCode === 409 || group.statusCode === 410)
    return "状態の競合や対象の失効などによって要求を受け付けられず、操作を継続できない可能性があるため、確認対象にしています。古い画面や確認テストでも発生します。"
  if (
    group.statusCode !== null &&
    group.statusCode >= 400 &&
    group.statusCode < 500
  )
    return "要求が拒否され、入力・通信の不整合や想定外のアクセスの可能性があるため、確認対象にしています。テストでも発生するため、繰り返しと利用者への影響を確認してください。"
  if (group.statusCode !== null && group.statusCode >= 500)
    return "サーバー側で要求を正常に処理できず、利用を妨げる可能性があるため、確認対象にしています。受付停止の確認テストでも発生するため、現在も続いているかを確認してください。"
  if (group.event === "llm.analysis.failed")
    return "解析を完了できなかった記録があり、利用者が結果を得られない可能性があるため、確認対象にしています。関連ログで失敗原因と再試行後の状況を確認してください。"
  if (
    group.event === "analysis_audit.queue.failed" ||
    group.event === "analysis_audit.delivery.failed" ||
    group.event === "analysis_attempt.record.failed" ||
    group.event === "analysis_completion.record.failed" ||
    group.event === "survey.submit.failed"
  )
    return "解析・回答の記録処理に失敗し、記録や受付が完了していない可能性があるため、確認対象にしています。関連ログと保存状況を確認してください。"
  if (group.event === "dependency.request.failed")
    return "依存サービスへの要求に失敗し、操作を完了できない可能性があるため、確認対象にしています。一時的な通信障害か、継続する問題かを確認してください。"
  if (group.event === "auth.participation_events.invalid_schema")
    return "参加履歴の形式に不整合があり、履歴が正しく表示されない可能性があるため、確認対象にしています。関連ログで不整合の範囲を確認してください。"
  if (group.event === "auth.participation_events.failed")
    return "参加履歴の取得に失敗し、同意・撤回の状況を確認できない可能性があるため、確認対象にしています。関連ログと再取得後の状況を確認してください。"
  if (group.event?.startsWith("auth.") === true)
    return "認証・撤回などの手続きに失敗し、利用者が手続きを完了できない可能性があるため、確認対象にしています。想定内の拒否か、処理の障害かを確認してください。"
  if (
    group.event?.startsWith("session.") === true ||
    group.event === "cookie.clear_all.failed"
  )
    return "ブラウザの認証・操作状態の処理に失敗し、利用の継続や復旧を妨げる可能性があるため、確認対象にしています。関連ログと利用者の状況を確認してください。"
  if (group.event?.startsWith("pdf.") === true)
    return "説明資料や同意・撤回書の処理に失敗し、必要な資料を取得できない可能性があるため、確認対象にしています。対象の資料と再試行後の状況を確認してください。"
  if (group.service === "scheduler")
    return "定期実行の警告・失敗があり、保守処理が実行されていない可能性があるため、確認対象にしています。最新の実行結果と定期メンテナンス欄を確認してください。"
  if (group.service === "admin")
    return "管理画面の処理に警告・失敗があり、情報の確認や更新を妨げる可能性があるため、確認対象にしています。関連ログと現在の操作結果を確認してください。"
  return "警告・失敗が記録され、正常な利用への影響を否定できないため、確認対象にしています。原因はこの集計だけでは特定できないため、関連ログで確認してください。"
}

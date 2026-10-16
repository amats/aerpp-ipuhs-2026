"use server"

import { env } from "@aerpp/config/server/admin"
import { requireAdminSession } from "@/lib/auth"
import { logRecoveryLookupFailure } from "@/lib/logger"
import { loadRecoveryRecords } from "./load-recovery-records"
import {
  type RecoveryLookupActionState,
  recoveryLookupInputSchema,
} from "./participation-recovery-lookup-types"
import { deriveRecoveryPseudonym } from "./recovery-pseudonym"

export async function lookupParticipationRecoveryAction(
  _previous: RecoveryLookupActionState,
  formData: FormData,
): Promise<RecoveryLookupActionState> {
  await requireAdminSession("/participant")
  const parsed = recoveryLookupInputSchema.safeParse({
    mode: formData.get("mode"),
    value: formData.get("value"),
  })
  if (parsed.success !== true)
    return { message: "メールアドレスまたはPIDを確認してください。" }
  const requestId = formData.get("requestId")
  if (typeof requestId !== "string" || !/^\d{1,10}$/.test(requestId))
    return { message: "再度照会してください。" }
  try {
    const pseudonym =
      parsed.data.mode === "email"
        ? deriveRecoveryPseudonym(parsed.data.value, env.identifierHashSecret)
        : parsed.data.value
    return {
      message:
        "記録を照会しました。参加者への確認も済ませてから復旧先を選んでください。",
      requestId,
      lookup: await loadRecoveryRecords(pseudonym),
    }
  } catch (error) {
    logRecoveryLookupFailure(error)
    return { message: "記録を照会できませんでした。再度照会してください。" }
  }
}

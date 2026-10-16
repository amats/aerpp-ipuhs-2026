import {
  ConsentBoundOwnerSchema,
  ParticipantRecordOwnerSchema,
  RecoveryDestinationSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const RECOVERY_LABELS = {
  "initial-document": "初回解析結果参照前のため初回の書類入力画面に戻す",
  "initial-survey": "研究者が確認した初回解析のアンケート入力画面に戻す",
  "follow-up-document": "フォローアップ状態の書類入力画面に戻す",
}

export const recoveryInputSchema = z.object({
  pseudonym: ParticipantRecordOwnerSchema.shape.pseudonym,
  destination: RecoveryDestinationSchema,
  analysisId: ConsentBoundOwnerSchema.shape.consentId.optional(),
  reason: z.string().trim().min(1).max(1000),
})

export const recoveryReviewSchema = recoveryInputSchema.extend({
  fingerprint: z.string().min(1).max(256),
  recoveryId: z.string().uuid(),
  status: z.string().min(1).max(64),
  questionnaireKind: z.enum(["initial", "follow-up"]),
  completedAt: z.number().finite().nullable(),
  presentedAt: z.number().finite().nullable(),
})
export type RecoveryReview = z.infer<typeof recoveryReviewSchema>
export type RecoveryActionState = { message: string; review?: RecoveryReview }

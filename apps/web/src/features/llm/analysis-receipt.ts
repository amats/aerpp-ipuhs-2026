import "server-only"

import {
  type AnalysisCompletionReceipt,
  analysisCompletionReceiptSchema,
} from "@/features/llm/analysis-receipt-types"
import { sealSessionData, unsealSessionData } from "@/lib/session-seal"

export async function sealAnalysisCompletionReceipt(
  receipt: AnalysisCompletionReceipt,
): Promise<string | null> {
  const parsedReceipt = analysisCompletionReceiptSchema.safeParse(receipt)
  if (!parsedReceipt.success) {
    return null
  }
  return await sealSessionData(parsedReceipt.data)
}

export async function unsealAnalysisCompletionReceipt(
  sealedReceipt: string,
): Promise<AnalysisCompletionReceipt | null> {
  const unsealedReceipt = await unsealSessionData<unknown>(sealedReceipt)
  const parsedReceipt =
    analysisCompletionReceiptSchema.safeParse(unsealedReceipt)
  return parsedReceipt.success ? parsedReceipt.data : null
}

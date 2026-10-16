"use server"

import {
  InformationInputSchema,
  InformationTargetSchema,
} from "@aerpp/firestore/information-types"
import { requireAdminSession } from "@/lib/auth"
import { logInformationFailure } from "@/lib/logger"
import { informationRepository } from "./information-service"
import type { InformationActionResult } from "./information-types"

export async function saveInformationAction(
  target: unknown,
  input: unknown,
): Promise<InformationActionResult> {
  await requireAdminSession("/information")
  const data = InformationInputSchema.safeParse(input)
  const parsedTarget =
    target === null ? null : InformationTargetSchema.safeParse(target)
  if (
    data.success === false ||
    (parsedTarget && parsedTarget.success === false)
  )
    return {
      ok: false,
      message:
        "本文・種別・有効期限を確認してください。本文は UTF-8 で 1,000,000 バイト以内です。",
    }
  try {
    const repository = informationRepository()
    if (parsedTarget?.success === true) {
      const result = await repository.update(parsedTarget.data, data.data)
      if (result.ok === false)
        return {
          ok: false,
          reason: "conflict",
          message:
            "別の操作で更新または削除されています。入力内容は保持しています。最新版を確認してから編集を再開してください。",
        }
    } else await repository.add(data.data)
    return { ok: true }
  } catch (error) {
    logInformationFailure(
      target === null ? "addInformation" : "updateInformation",
      error,
    )
    return {
      ok: false,
      message:
        "保存結果を確認できませんでした。権限・接続を確認し、再送信する前に一覧を再読み込みしてください。",
    }
  }
}

export async function deleteInformationAction(
  target: unknown,
): Promise<InformationActionResult> {
  await requireAdminSession("/information")
  const parsed = InformationTargetSchema.safeParse(target)
  if (parsed.success === false)
    return {
      ok: false,
      message: "削除対象が不正です。一覧を再読み込みしてください。",
    }
  try {
    const result = await informationRepository().remove(parsed.data)
    if (result.ok === false)
      return {
        ok: false,
        reason: "conflict",
        message:
          "別の操作で更新または削除されています。最新版を確認し、削除を選び直してください。",
      }
    return { ok: true }
  } catch (error) {
    logInformationFailure("deleteInformation", error)
    return {
      ok: false,
      message:
        "削除結果を確認できませんでした。権限・接続を確認し、一覧を再読み込みしてください。",
    }
  }
}

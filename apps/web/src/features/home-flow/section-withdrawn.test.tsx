import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { AppContextState } from "@/features/app-context/app-context-types"
import { Stage } from "@/features/app-context/stage-types"
import SectionWithdrawn from "./section-withdrawn"

const context = vi.hoisted(() => ({
  stage: "withdrawn",
  withdrawalCleanupStatus:
    "unconfirmed" as AppContextState["withdrawalCleanupStatus"],
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => context,
}))

describe("withdrawn home cleanup guidance", () => {
  it.each([
    ["complete", "データの消去が完了しました"],
    ["pending", "データの消去はまだ完了していません"],
    ["localFailed", "ブラウザー内の一時データを消去できませんでした"],
    ["unconfirmed", "データの消去完了は未確認です"],
    ["stateFailed", "撤回状態を保存できませんでした"],
  ] as const)("shows the %s outcome", (status, message) => {
    context.stage = Stage.withdrawn
    context.withdrawalCleanupStatus = status
    const html = renderToStaticMarkup(
      <SectionWithdrawn contactEmail="support@example.invalid" />,
    )
    expect(html).toContain(message)
    expect(html).toContain("同意履歴・関連書類（同意撤回書の控え）")
    expect(html).toContain("研究責任者による復旧許可が必要です")
    expect(html).toContain('href="mailto:support@example.invalid"')
    expect(html).toContain('href="/download"')
    expect(html).not.toContain("開始画面へ戻ります")
    expect(html).toContain("研究参加の撤回を受け付けました")
    expect(html).not.toContain("研究参加の撤回が完了しました")
    if (status === "complete") {
      expect(html).toContain("ブラウザーを閉じて構いません")
      expect(html).not.toContain("データ削除の再試行")
    } else {
      expect(html).not.toContain("ブラウザーを閉じて構いません")
      expect(html).toContain("データ削除の再試行")
    }
    if (status === "pending") {
      expect(html).toContain("前回の確認が終わってから約30秒後")
      expect(html).toContain("消去完了までの時間はデータ量や通信状況")
    }
    if (status === "localFailed") expect(html).toContain("ページを再読み込み")
  })

  it("does not show a previous completion outside the withdrawn stage", () => {
    context.stage = Stage.unauthenticated
    context.withdrawalCleanupStatus = "complete"
    expect(
      renderToStaticMarkup(
        <SectionWithdrawn contactEmail="support@example.invalid" />,
      ),
    ).toBe("")
  })
})

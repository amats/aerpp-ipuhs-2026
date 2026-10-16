import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import OperationalAttention from "./operational-attention"
import { buildOperationalSummary } from "./operational-log-summary"
import { buildOperationalUsage } from "./operational-usage"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/features/log/load-operational-page-data", () => ({
  loadOperationalPageData: mocks.load,
}))
vi.mock("@/features/log/operational-console-url", () => ({
  operationalConsoleUrl: () => null,
}))

import OperationalStatus from "./operational-status"

beforeEach(() => vi.resetAllMocks())
it("authenticates before any operational data reads", async () => {
  mocks.auth.mockRejectedValue(new Error("redirect"))
  await expect(OperationalStatus({})).rejects.toThrow("redirect")
  expect(mocks.auth).toHaveBeenCalledWith("/log")
  expect(mocks.load).not.toHaveBeenCalled()
})
it.each([null, "一部の定期処理を取得できませんでした"])(
  "renders independent maintenance results even alongside a partial failure: %s",
  async (maintenanceError) => {
    const since = "2026-10-08T00:00:00.000Z"
    const until = "2026-10-09T00:00:00.000Z"
    const entries = [
      {
        id: "one",
        timestamp: until,
        service: "support" as const,
        severity: "ERROR" as const,
        event: null,
        operation: "mailHealth",
        code: "MAIL_REAUTHORIZATION_REQUIRED",
        outcome: null,
        statusCode: null,
        counts: {},
      },
    ]
    mocks.load.mockResolvedValue({
      filters: { periodDays: 1, dataPurpose: "test", serverId: "synthetic" },
      loadedAt: until,
      logs: {
        entries,
        maintenanceEntries: [
          {
            ...entries[0],
            operation: "withdrawalCleanup",
            code: "MAINTENANCE_OUTSIDE_WINDOW",
          },
        ],
        since,
        until,
        error: null,
        maintenanceError,
        truncated: true,
      },
      usage: {
        ok: true,
        data: buildOperationalUsage({
          events: [],
          attempts: [],
          surveys: [],
          since: new Date(since),
          until: new Date(until),
        }),
      },
      summary: buildOperationalSummary(entries),
    })
    const html = renderToStaticMarkup(await OperationalStatus({}))
    for (const text of [
      "取得分のみの集計",
      "メール基盤の再認証が必要",
      "認証メールを送れない可能性",
      "対象期間外のスキップ",
      "記録を確認できません",
      "2026/10/09 9:00（日本時間）",
      "現在保持されている記録",
      'name="dataPurpose" value="test"',
      'href="/survey?dataPurpose=test"',
    ])
      expect(html).toContain(text)
    if (maintenanceError !== null) expect(html).toContain(maintenanceError)
    expect(html).not.toContain("ログ本文")
  },
)

it("keeps request warnings visible with separate status and reasons, and exposes the same investigation query as the link", () => {
  const since = "2026-10-08T00:00:00.000Z"
  const until = "2026-10-09T00:00:00.000Z"
  const { attention } = buildOperationalSummary(
    [200, 401, 404, 503].map((statusCode) => ({
      id: String(statusCode),
      timestamp: until,
      service: "support" as const,
      severity:
        statusCode === 200 || statusCode >= 500
          ? ("ERROR" as const)
          : ("WARNING" as const),
      event: statusCode === 200 ? "auth.withdraw.failed" : null,
      operation: null,
      code: null,
      outcome: null,
      statusCode,
      counts: {},
    })),
  )
  const html = renderToStaticMarkup(
    <OperationalAttention
      groups={attention}
      error={null}
      truncated={false}
      since={since}
      until={until}
    />,
  )
  expect(attention).toHaveLength(4)
  for (const text of [
    "HTTP 401",
    "HTTP 200",
    "HTTP通信は成功していますが",
    "サーバー側の受付結果は関連ログで確認してください",
    "認証によるアクセス拒否",
    "HTTP 404",
    "アクセス先・対象不明",
    "HTTP 503",
    "サービス利用不可",
    "正規利用者のアクセス障害や不審なアクセス",
    "リンク切れや想定外のアクセス",
    "サーバー側で要求を正常に処理できず",
    "テストや想定内の拒否も含まれ",
    "httpRequest.status=401",
    "httpRequest.status=404",
    "httpRequest.status=503",
    "ログの検索条件を表示",
    "ログの検索条件をコピー",
  ])
    expect(html).toContain(text)
})

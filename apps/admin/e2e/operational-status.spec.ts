import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test("operational status preserves filters, separates outcomes and unavailable logs, and scrolls locally on phones", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const paths: string[] = []
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  const prefix = "operations-synthetic"
  try {
    async function readMetric(label: string): Promise<number> {
      return Number(
        (
          await page
            .locator("#usage p")
            .filter({ hasText: new RegExp(`^${label}$`) })
            .locator("..")
            .locator("p")
            .last()
            .innerText()
        ).replace("件", ""),
      )
    }
    await page.goto("/log?dataPurpose=all&period=30")
    const baselineAll30 = await readMetric("解析開始")
    await page.goto("/log?dataPurpose=all&period=7")
    const baselineAll7 = await readMetric("解析開始")
    await page.goto("/log?dataPurpose=test&period=7")
    const labels = [
      "同意確認",
      "解析完了",
      "解析失敗",
      "解析中断",
      "終了未確認",
      "解析完了の記録",
      "アンケート提出",
      "解析開始",
    ]
    const baseline = Object.fromEntries(
      await Promise.all(
        labels.map(async (label) => [label, await readMetric(label)]),
      ),
    )
    const batch = database.batch()
    function set(
      collection: string,
      id: string,
      data: Record<string, unknown>,
    ) {
      const path = `${collection}/${prefix}-${id}`
      paths.push(path)
      batch.set(database.doc(path), {
        pseudonym: prefix,
        clientId: prefix,
        consentId: prefix,
        serverId: "purpose-server",
        dataPurpose: "test",
        ...data,
      })
    }
    set("participationEvents", "consent", {
      eventType: "consent",
      consentConfirmedAt: Timestamp.now(),
    })
    for (const outcome of ["completed", "failed", "cancelled", "running"])
      set("analysisAttempts", outcome, { startedAtMs: Date.now(), outcome })
    set("analysisAttempts", "old", {
      startedAtMs: Date.now() - 10 * 86_400_000,
      outcome: "completed",
    })
    set("analysisAttempts", "other-server", {
      serverId: "other-server",
      startedAtMs: Date.now(),
      outcome: "completed",
    })
    set("analysisAttempts", "research", {
      dataPurpose: "research",
      startedAtMs: Date.now(),
      outcome: "completed",
    })
    set("analysisQuestionnaires", "unsubmitted", {
      createdAt: Timestamp.now(),
      submittedAt: null,
    })
    set("analysisQuestionnaires", "submitted", {
      createdAt: Timestamp.fromMillis(Date.now() - 10 * 86_400_000),
      submittedAt: Timestamp.now(),
    })
    await batch.commit()
    await page.goto("/log?dataPurpose=test&period=7&serverId=other-server")
    await expect(
      page.getByRole("heading", { name: "運用状況", exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("データ区分", { exact: true })).toHaveValue(
      "test",
    )
    await expect(page.getByLabel("期間", { exact: true })).toHaveValue("7")
    const usage = page.locator("#usage")
    for (const label of [
      "同意確認",
      "解析完了",
      "解析失敗",
      "解析中断",
      "終了未確認",
      "解析完了の記録",
      "アンケート提出",
    ])
      await expect(
        usage
          .locator("p")
          .filter({ hasText: new RegExp(`^${label}$`) })
          .locator(".."),
      ).toContainText(`${baseline[label] + 1}件`)
    await expect(
      usage
        .locator("p")
        .filter({ hasText: /^解析開始$/ })
        .locator(".."),
    ).toContainText(`${baseline.解析開始 + 4}件`)
    await expect(page.locator("#attention")).toContainText(
      "ローカル検証環境では Cloud Logging を利用しません。",
    )
    await expect(page.locator("#maintenance").getByRole("status")).toHaveText(
      "ローカル検証環境では Cloud Logging を利用しません。",
    )
    await expect(
      page.getByText("取得したログに確認対象の事象はありません。", {
        exact: false,
      }),
    ).toHaveCount(0)
    await expect(
      page.getByText("利用状況：serverId purpose-server", { exact: false }),
    ).toBeVisible()
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
      }
      await page.setViewportSize({ width: 390, height: 900 })
      await page.screenshot({
        path: testInfo.outputPath(`operations-${colorScheme}.png`),
        fullPage: true,
      })
    }
    const region = usage.getByRole("region", {
      name: "日別の利用状況",
      exact: true,
    })
    await region.focus()
    await page.keyboard.press("ArrowRight")
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0)
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.searchParams.has("serverId") === false &&
          url.searchParams.get("dataPurpose") === "test" &&
          url.searchParams.get("period") === "7",
        { waitUntil: "load" },
      ),
      page.getByRole("button", { name: "更新", exact: true }).click(),
    ])
    await page.getByLabel("データ区分", { exact: true }).selectOption("all")
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("period") === "7" &&
        url.searchParams.get("dataPurpose") === "all",
    )
    await expect(
      usage
        .locator("p")
        .filter({ hasText: /^解析開始$/ })
        .locator(".."),
    ).toContainText(`${baselineAll7 + 5}件`)
    await page.getByLabel("期間", { exact: true }).selectOption("30")
    await page.getByRole("button", { name: "更新", exact: true }).click()
    await expect(
      usage
        .locator("p")
        .filter({ hasText: /^解析開始$/ })
        .locator(".."),
    ).toContainText(`${baselineAll30 + 6}件`)
    await page.reload()
    await expect(page.getByLabel("期間", { exact: true })).toHaveValue("30")
    await expect(page.getByLabel("データ区分", { exact: true })).toHaveValue(
      "all",
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "ダッシュボード", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "要対応事項", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "運用状況へ", exact: true }),
    ).toHaveAttribute("href", "/log?dataPurpose=all")
    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "参加・回答履歴", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "参加・回答履歴", exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("データ区分", { exact: true })).toHaveValue(
      "all",
    )
  } finally {
    const batch = database.batch()
    for (const path of paths) batch.delete(database.doc(path))
    await batch.commit()
    await database.terminate()
  }
})

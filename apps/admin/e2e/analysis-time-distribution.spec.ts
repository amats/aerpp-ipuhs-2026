import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test("shows the time histogram, counts and empty state across purpose filters and reloads", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  const records = [
    ...[0, 1, 2, 3, 4, 5, 6, 9, null, -1].map((processingDurationSeconds) => ({
      processingDurationSeconds,
      dataPurpose: "research",
    })),
    { processingDurationSeconds: 30, dataPurpose: "test" },
    { processingDurationSeconds: 30, dataPurpose: "test" },
    {
      processingDurationSeconds: 10000,
      dataPurpose: "research",
      serverId: "another-server",
    },
  ]
  const refs = records.map((_, index) =>
    database.doc(`analysisQuestionnaires/time-distribution-${index}`),
  )
  try {
    const batch = database.batch()
    records.forEach((record, index) => {
      batch.set(refs[index], {
        serverId: "purpose-server",
        pseudonym: `synthetic-time-${index}`,
        createdAt: Timestamp.fromMillis(1700000000000),
        ...record,
      })
    })
    await batch.commit()
    await page.goto("/survey")
    const distribution = page.getByRole("region", {
      name: "解析時間の分布",
      exact: true,
    })
    await expect(distribution).toContainText("集計対象: 8件 ／ 時間不明: 2件")
    await expect(distribution).toContainText("Freedman–Diaconis法")
    await expect(
      distribution.getByRole("img", { name: "解析時間のヒストグラム" }),
    ).toBeVisible()
    await distribution.getByText("区間ごとの件数", { exact: true }).click()
    const rows = distribution.getByRole("table").locator("tbody tr")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveText("0秒以上 3秒未満3")
    await expect(rows.nth(1)).toHaveText("3秒以上 6秒未満3")
    await expect(rows.nth(2)).toHaveText("6秒以上 9秒以下2")
    await expect(page.getByText(/平均/)).toHaveCount(0)
    await distribution.screenshot({
      path: testInfo.outputPath("analysis-time-desktop.png"),
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: "dark" })
    await distribution.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    expect(
      await distribution
        .getByRole("img")
        .evaluate(
          (chart) => chart.getBoundingClientRect().right <= window.innerWidth,
        ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath("analysis-time-mobile.png"),
    })

    await page.getByLabel("データ区分", { exact: true }).selectOption("test")
    await expect(distribution).toContainText("集計対象: 2件 ／ 時間不明: 0件")
    await expect(distribution).toContainText("すべて同じ解析時間")
    await page.getByLabel("データ区分", { exact: true }).selectOption("all")
    await expect(distribution).toContainText("集計対象: 10件 ／ 時間不明: 2件")
    await page
      .getByLabel("データ区分", { exact: true })
      .selectOption("unclassified")
    await expect(distribution).toContainText("表示できる解析時間がありません。")
    await expect(distribution.getByRole("img")).toHaveCount(0)

    await page
      .getByLabel("データ区分", { exact: true })
      .selectOption("research")
    await expect(distribution).toContainText("集計対象: 8件 ／ 時間不明: 2件")
    await refs[0].update({ processingDurationSeconds: null })
    await page.reload()
    await expect(distribution).toContainText("集計対象: 7件 ／ 時間不明: 3件")
    expect(pageErrors).toEqual([])
  } finally {
    const batch = database.batch()
    for (const ref of refs) batch.delete(ref)
    await batch.commit()
    await database.terminate()
  }
})

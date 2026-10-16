import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test("dashboard shows retained analysis counts with purpose filtering, reload and detail navigation", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const records = [
    { dataPurpose: "research", outcome: "completed" },
    { dataPurpose: "research", outcome: "failed" },
    { dataPurpose: "research", outcome: "cancelled" },
    { dataPurpose: "research" },
    { dataPurpose: "test", outcome: "completed" },
    { outcome: "failed" },
    { dataPurpose: "research", outcome: "completed", serverId: "other" },
  ]
  const refs = records.map((_, index) =>
    database.doc(`analysisAttempts/dashboard-analysis-${index}`),
  )
  const labels = ["解析開始回数", "解析完了", "失敗", "中断", "終了未確認"]
  const card = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "解析の実行状況", exact: true }),
    })
    .last()
  const metric = (label: string) =>
    card.getByText(label, { exact: true }).locator("..").locator("p").last()
  const scopes = ["research", "test", "unclassified", "all"] as const
  const baselines: Record<string, number[]> = {}
  try {
    for (const purpose of scopes) {
      await page.goto(`/dashboard?dataPurpose=${purpose}`)
      await expect(card).toBeVisible()
      baselines[purpose] = await Promise.all(
        labels.map(async (label) => Number(await metric(label).innerText())),
      )
    }
    const batch = database.batch()
    records.forEach((record, index) => {
      batch.set(refs[index], {
        serverId: "purpose-server",
        startedAtMs: 1700000000000,
        ...record,
      })
    })
    await batch.commit()
    const increments = {
      research: [4, 1, 1, 1, 1],
      test: [1, 1, 0, 0, 0],
      unclassified: [1, 0, 1, 0, 0],
      all: [6, 2, 2, 1, 1],
    }
    for (const purpose of scopes) {
      await page.goto(`/dashboard?dataPurpose=${purpose}`)
      for (const [index, label] of labels.entries())
        await expect(metric(label)).toHaveText(
          String(baselines[purpose][index] + increments[purpose][index]),
        )
      await expect(card.getByRole("link", { name: "詳細へ" })).toHaveAttribute(
        "href",
        `/survey?dataPurpose=${purpose}`,
      )
    }
    await refs[3].update({ outcome: "completed" })
    await page.reload()
    await expect(metric("解析完了")).toHaveText(String(baselines.all[1] + 3))
    await expect(metric("終了未確認")).toHaveText(String(baselines.all[4]))
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 320, height: 900 })
      await card.scrollIntoViewIfNeeded()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`dashboard-analysis-${colorScheme}.png`),
      })
    }
    await card.getByRole("link", { name: "詳細へ" }).click()
    await expect(page).toHaveURL(/\/survey\?dataPurpose=all$/)
    await expect(
      page.getByRole("heading", { name: "解析の実行状況", exact: true }),
    ).toBeVisible()
  } finally {
    const batch = database.batch()
    for (const ref of refs) batch.delete(ref)
    await batch.commit()
    await database.terminate()
  }
})

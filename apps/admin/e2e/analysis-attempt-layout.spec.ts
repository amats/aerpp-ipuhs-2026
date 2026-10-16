import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test("analysis attempts show an empty state or a readable locally scrolling table", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const record = database.doc("analysisAttempts/attempt-layout-synthetic")
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  try {
    await page.goto("/survey?dataPurpose=unclassified")
    const empty = page.getByText("該当する解析の実行記録はありません。", {
      exact: true,
    })
    const table = page.getByRole("table", {
      name: "解析の実行記録",
      exact: true,
    })
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(empty).toBeVisible()
      await expect(table).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    }
    await empty.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath("empty-attempts-390.png"),
    })

    await record.set({
      pseudonym: `aerpp:pid-${"T".repeat(32)}`,
      consentId: "attempt-layout-consent",
      clientId: "attempt-layout-client",
      analysisId: "attempt-layout-synthetic",
      serverId: "purpose-server",
      startedAtMs: Date.now(),
      outcome: "completed",
      questionnaireKind: "initial",
      documentGraphemeCounts: [4, 7],
      durationMs: 5000,
    })
    await page.reload()
    await expect(empty).toHaveCount(0)
    await expect(table).toBeVisible()
    const scrollArea = page.getByRole("region", {
      name: "解析の実行記録",
      exact: true,
    })
    const header = table.getByRole("columnheader", {
      name: "アンケート区分",
      exact: true,
    })
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await scrollArea.scrollIntoViewIfNeeded()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
        expect(
          await header.evaluate((element) => element.clientHeight),
        ).toBeLessThan(60)
        if (width <= 390) {
          expect(
            await scrollArea.evaluate(
              (element) => element.scrollWidth > element.clientWidth,
            ),
          ).toBe(true)
          await scrollArea.evaluate((element) => {
            element.scrollLeft = 0
          })
          await scrollArea.focus()
          await page.keyboard.press("ArrowRight")
          await expect
            .poll(() => scrollArea.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0)
        }
        if (width === 390)
          await page.screenshot({
            path: testInfo.outputPath(`attempts-390-${colorScheme}.png`),
          })
      }
    }
  } finally {
    await record.delete()
    await database.terminate()
  }
})

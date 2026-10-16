import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
})

test("participant history keeps readable headings with empty and populated records", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const record = database.doc("participationEvents/participant-layout-consent")
  try {
    for (const populated of [false, true]) {
      if (populated === true)
        await record.set({
          pseudonym: `aerpp:pid-${"a".repeat(32)}`,
          consentId: record.id,
          clientId: "participant-layout-client",
          serverId: "purpose-server",
          dataPurpose: "research",
          eventType: "consent",
          consentRequestedAt: Timestamp.now(),
          consentConfirmedAt: Timestamp.now(),
        })
      await page.goto("/participant")
      const table = page.getByRole("table")
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme })
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          expect(
            await table
              .locator("thead")
              .evaluate((element) => element.clientHeight),
          ).toBeLessThan(60)
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true)
          const summary = await page
            .getByText("最新状態の人数", { exact: true })
            .boundingBox()
          const activity = await page
            .getByRole("heading", { name: "直近の参加者更新", exact: true })
            .boundingBox()
          const verification = await page
            .getByRole("heading", { name: "PDFのDID照合", exact: true })
            .boundingBox()
          expect(summary).not.toBeNull()
          expect(activity).not.toBeNull()
          expect(verification).not.toBeNull()
          expect(summary?.y).toBeLessThan(activity?.y ?? 0)
          expect(activity?.y).toBeLessThan(verification?.y ?? 0)
          if (width === 320) {
            const scrollArea = page.getByRole("region", {
              name: "同意・撤回の履歴",
              exact: true,
            })
            await scrollArea.scrollIntoViewIfNeeded()
            await scrollArea.evaluate((element) => {
              element.scrollLeft = 0
            })
            await scrollArea.focus()
            await page.keyboard.press("ArrowRight")
            await expect
              .poll(() => scrollArea.evaluate((element) => element.scrollLeft))
              .toBeGreaterThan(0)
            await page.screenshot({
              path: testInfo.outputPath(
                `history-${populated ? "populated" : "empty"}-${colorScheme}.png`,
              ),
            })
          }
        }
      }
    }
  } finally {
    await record.delete()
    await database.terminate()
  }
})

test("recovery authorization history wraps complete identifiers and reasons within its card", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const record = database.doc("participationEvents/participant-layout-recovery")
  const pseudonym = `aerpp:pid-${"a".repeat(32)}`
  const analysisId = `analysis-${"b".repeat(32)}`
  const reason = `合成データでの表示確認 ${"R".repeat(200)}`
  try {
    await record.set({
      pseudonym,
      serverId: "purpose-server",
      dataPurpose: "research",
      eventType: "recovery_authorized",
      destination: "initial-survey",
      analysisId,
      reason,
      actorId: "c".repeat(64),
      authorizedAt: Timestamp.now(),
    })
    await page.goto("/participant")
    const history = page.getByRole("region", {
      name: "参加再開の許可記録",
      exact: true,
    })
    await expect(history).toContainText(pseudonym)
    await expect(history).toContainText(analysisId)
    await expect(history).toContainText(reason)
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await history.scrollIntoViewIfNeeded()
        expect(
          await history.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
        if (width === 320)
          await page.screenshot({
            path: testInfo.outputPath(`recovery-320-${colorScheme}.png`),
          })
      }
    }
  } finally {
    await record.delete()
    await database.terminate()
  }
})

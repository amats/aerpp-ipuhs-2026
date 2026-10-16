import { readFileSync } from "node:fs"
import path from "node:path"
import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
})

test("recent activity keeps full participant identifiers within narrow screens", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const id = "ui-layout-synthetic"
  const pseudonym = `aerpp:pid-${"M".repeat(32)}`
  const owner = {
    pseudonym,
    consentId: id,
    clientId: id,
    serverId: "purpose-server",
    dataPurpose: "research",
  }
  try {
    const batch = database.batch()
    batch.set(database.doc(`participationEvents/${id}`), {
      ...owner,
      eventType: "consent",
      consentConfirmedAt: Timestamp.now(),
    })
    batch.set(database.doc(`analysisQuestionnaires/${id}`), {
      ...owner,
      analysisId: id,
      submittedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    })
    await batch.commit()

    for (const path of ["/participant", "/survey", "/updates"]) {
      await page.goto(path)
      const activity = page
        .getByText(`${pseudonym} が`, { exact: false })
        .first()
      await expect(activity).toBeVisible()
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme })
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await activity.scrollIntoViewIfNeeded()
          const bounds = await activity.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds?.x).toBeGreaterThanOrEqual(0)
          expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
            width,
          )
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true)
          if (width === 390)
            await page.screenshot({
              path: testInfo.outputPath(`${path.slice(1)}-${colorScheme}.png`),
            })
        }
      }
    }
  } finally {
    const batch = database.batch()
    batch.delete(database.doc(`participationEvents/${id}`))
    batch.delete(database.doc(`analysisQuestionnaires/${id}`))
    await batch.commit()
    await database.terminate()
  }
})

test("license notices hydrate with complete text including leading CRLF notices", async ({
  page,
}, testInfo) => {
  const failures: string[] = []
  page.on("pageerror", (error) => failures.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  const dependencies = JSON.parse(
    readFileSync(
      path.resolve(
        testInfo.project.testDir,
        "../generated/licenses/dependencies.json",
      ),
      "utf8",
    ),
  ) as { name: string; applications: string[]; notices: { text: string }[] }[]
  const dependency = dependencies.find(
    (entry) => entry.name === "@grpc/grpc-js",
  )
  expect(dependency?.notices.some(({ text }) => text.startsWith("\r\n"))).toBe(
    true,
  )

  await page.goto("/license")
  await expect(page.locator("details details > summary")).toHaveCount(
    dependencies.filter((entry) => entry.applications.includes("admin")).length,
  )
  await page
    .getByRole("navigation", { name: "ライセンスの目次" })
    .getByRole("link", { name: "第三者のライセンス", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "第三者のライセンス・著作権表示" }),
  ).toBeInViewport()
  const summary = page
    .locator("summary")
    .filter({ hasText: /^@grpc\/grpc-js@/ })
  const group = page.locator("summary").filter({ hasText: /^G–L（/ })
  await group.focus()
  await page.keyboard.press("Enter")
  await summary.click()
  const rendered = await summary.locator("..").locator("pre").allTextContents()
  expect(rendered).toEqual(
    dependency?.notices.map(({ text }) => text.replace(/\r\n?/g, "\n")),
  )
  await page.getByRole("link", { name: "管理画面に戻る", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "管理ダッシュボード", exact: true }),
  ).toBeVisible()
  expect(failures).toEqual([])
})

test("mobile header keeps navigation and environment details reachable without hiding the current filter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto("/participant?dataPurpose=test")
  const navigation = page.getByRole("navigation", {
    name: "メインナビゲーション",
  })
  const menu = page.getByRole("button", { name: "メニュー・環境情報" })
  await expect(navigation).toBeHidden()
  await expect(
    page.getByRole("heading", { name: "参加者", exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("データ区分")).toHaveValue("test")
  expect((await page.locator("header").boundingBox())?.height).toBeLessThan(280)
  await menu.focus()
  await page.keyboard.press("Enter")
  await expect(navigation).toBeVisible()
  const environment = page
    .locator("summary")
    .filter({ hasText: "アカウント・環境情報" })
  await environment.focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByText("serverId: purpose-server", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("Web受付終了日時：", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("Support終了日時：", { exact: false }),
  ).toBeVisible()
  await navigation
    .getByRole("link", { name: "アンケート結果", exact: true })
    .click()
  await expect(page).toHaveURL(/\/survey\?dataPurpose=test$/)
  await expect(menu).toHaveAttribute("aria-expanded", "false")
  await expect(navigation).toBeHidden()
  await expect(page.getByLabel("データ区分")).toHaveValue("test")
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(navigation).toBeVisible()
  await page.setViewportSize({ width: 320, height: 900 })
  await expect(navigation).toBeHidden()
  await expect(menu).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test("notice and export panels use columns on desktop and stack on phones", async ({
  page,
}) => {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [route, firstTitle, secondTitle] of [
      ["/information", "お知らせを追加", "登録済みのお知らせ"],
      ["/research", "研究用データ", "参加管理・アクセスデータ"],
    ]) {
      await page.goto(route)
      const first = await page
        .getByRole("heading", { name: firstTitle, exact: true })
        .boundingBox()
      const second = await page
        .getByRole("heading", { name: new RegExp(`^${secondTitle}`) })
        .boundingBox()
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      if (width === 1440) {
        expect(second?.y).toBe(first?.y)
        expect(second?.x).toBeGreaterThan(first?.x ?? 0)
      } else {
        expect(second?.y).toBeGreaterThan(first?.y ?? 0)
        expect(second?.x).toBe(first?.x)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  }
})

for (const colorScheme of ["light", "dark"] as const) {
  test(`pending export controls fit narrow screens and support keyboard cancellation in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/research/export?*", async (route) => {
      await held
      await route.abort()
    })
    await page.emulateMedia({ colorScheme })
    const research = page.locator("section").filter({
      has: page.getByRole("heading", { name: "研究用データ", exact: true }),
    })
    const access = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "参加管理・アクセスデータ",
        exact: true,
      }),
    })
    try {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto("/research")
        for (const section of [research, access]) {
          await section.getByRole("button", { name: /を保存（ZIP）$/ }).click()
          await expect(
            section.getByRole("button", {
              name: "ZIPを準備しています…",
              exact: true,
            }),
          ).toBeDisabled()
        }
        for (const section of [research, access]) {
          const pending = section.getByRole("button", {
            name: "ZIPを準備しています…",
            exact: true,
          })
          const cancel = section.getByRole("button", { name: /の待機を中止$/ })
          await expect(cancel).toBeVisible()
          const panelBounds = await section.boundingBox()
          const pendingBounds = await pending.boundingBox()
          const cancelBounds = await cancel.boundingBox()
          const statusBounds = await section.getByRole("status").boundingBox()
          expect(panelBounds).not.toBeNull()
          expect(pendingBounds).not.toBeNull()
          expect(cancelBounds).not.toBeNull()
          expect(statusBounds).not.toBeNull()
          if (!panelBounds || !pendingBounds || !cancelBounds || !statusBounds)
            throw new Error("Export controls must have rendered bounds")
          expect(cancelBounds.height).toBeGreaterThanOrEqual(44)
          expect(cancelBounds.width).toBeGreaterThanOrEqual(44)
          expect(cancelBounds.x).toBeGreaterThanOrEqual(panelBounds.x)
          expect(cancelBounds.x + cancelBounds.width).toBeLessThanOrEqual(
            panelBounds.x + panelBounds.width,
          )
          expect(cancelBounds.y).toBeGreaterThanOrEqual(
            pendingBounds.y + pendingBounds.height,
          )
          expect(statusBounds.y).toBeGreaterThanOrEqual(
            cancelBounds.y + cancelBounds.height,
          )
          expect(
            await cancel.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBe(true)
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(
            `exports-pending-${width}-${colorScheme}.png`,
          ),
          fullPage: true,
        })

        const researchCancel = research.getByRole("button", {
          name: /の待機を中止$/,
        })
        await researchCancel.focus()
        await page.keyboard.press("Enter")
        await expect(
          research.getByRole("button", {
            name: "研究用データを保存（ZIP）",
            exact: true,
          }),
        ).toBeFocused()
        await expect(
          access.getByRole("button", {
            name: "ZIPを準備しています…",
            exact: true,
          }),
        ).toBeDisabled()
        await page.keyboard.press("Tab")
        await expect(
          access.getByRole("button", { name: /の待機を中止$/ }),
        ).toBeFocused()
        await page.keyboard.press("Space")
        await expect(
          access.getByRole("button", {
            name: "参加管理・アクセスデータを保存（ZIP）",
            exact: true,
          }),
        ).toBeFocused()
        await expect(
          page.getByRole("button", { name: /の待機を中止$/ }),
        ).toHaveCount(0)
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "取得待機を中止しました" }),
        ).toHaveCount(2)
        await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(
            `exports-cancelled-${width}-${colorScheme}.png`,
          ),
          fullPage: true,
        })
      }
    } finally {
      release()
    }
  })
}

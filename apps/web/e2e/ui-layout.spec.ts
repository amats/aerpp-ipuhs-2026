import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  openDocuments,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

test("result status, line breaks and optional actions remain readable across screen sizes", async ({
  page,
}, testInfo) => {
  await analyzeDocument(page)
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "解析結果", exact: true }),
  })
  const status = section.getByText("解析が終了しました。", { exact: true })
  const warning = section.getByText(
    "この結果をそのまま申請に用いないでください。",
  )
  const result = section.locator(".prose")
  const cleanup = section.getByText("初回はアンケート送信後に", {
    exact: false,
  })
  await expect(result.locator("p").first()).toHaveJSProperty(
    "innerHTML",
    "【総合評価】<br>\n架空の研究計画を確認しました。",
  )
  await expect(
    section.getByText("必要に応じてWord形式で保存できます。", { exact: true }),
  ).toBeVisible()

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const statusBox = await status.boundingBox()
      const warningBox = await warning.boundingBox()
      const resultBox = await result.boundingBox()
      const cleanupBox = await cleanup.boundingBox()
      if (!statusBox || !warningBox || !resultBox || !cleanupBox)
        throw new Error(
          "Result content must be visible before checking its layout",
        )
      expect(statusBox.y).toBeLessThan(warningBox.y)
      expect(warningBox.y).toBeLessThan(resultBox.y)
      expect(cleanupBox.y).toBeGreaterThan(resultBox.y + resultBox.height)
      for (const button of await section.getByRole("button").all()) {
        await button.scrollIntoViewIfNeeded()
        await expect(button).toBeInViewport({ ratio: 1 })
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await section.screenshot({
        path: testInfo.outputPath(`result-${width}-${colorScheme}.png`),
        animations: "disabled",
      })
    }
  }

  await page.emulateMedia({ colorScheme: "light" })
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(section).toBeVisible()
  await expect(
    section.getByText("この解析のアンケートは送信済みです。再回答は不要です。"),
  ).toBeVisible()
  await expect(
    section.getByText("アンケートへのご協力", { exact: false }),
  ).toHaveCount(0)
  await expect(
    section.getByRole("button", { name: "アンケートを開く" }),
  ).toHaveCount(0)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await section.screenshot({
      path: testInfo.outputPath(`result-submitted-${width}.png`),
      animations: "disabled",
    })
  }
})

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`full progress starts expanded and remains keyboard accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const progress = page.getByRole("navigation", { name: "進行中のステップ" })
    const steps = progress.locator("ol")
    const toggle = progress.getByRole("button", { name: /^全ステップを/ })
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(toggle).toHaveText("全ステップを閉じる")
    await expect(steps).toBeVisible()
    await expect(steps.getByRole("listitem")).toHaveCount(8)
    await expect(steps.locator('[aria-current="step"]')).toHaveCount(1)
    await expect(
      progress.getByText("Step 1 / 8", { exact: true }),
    ).toBeVisible()
    await toggle.focus()
    await page.keyboard.press("Enter")
    await expect(steps).toBeHidden()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toHaveText("全ステップを表示")
    await page.keyboard.press("Enter")
    await expect(steps).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(toggle).toBeFocused()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  })
}

test("survey selections can be cleared and actions fit narrow screens", async ({
  page,
  localServices,
}, testInfo) => {
  await sendConsent(page)
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of [/^認証メールを再送/, /^次に進む$/]) {
      const button = page.getByRole("button", { name })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport({ ratio: 1 })
    }
  }
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await expect(documentInput(page)).toBeVisible()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect((await documentInput(page).boundingBox())?.width).toBeGreaterThan(
      width * 0.75,
    )
  }
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  const rating = page.locator('[data-survey-question="PE1"]')
  const choice = page.locator('[data-survey-question="BG1"]')
  const select = choice.getByRole("combobox")
  const clearRating = rating.getByRole("button", { name: /^選択を解除/ })
  await expect(choice.getByRole("button")).toHaveCount(0)
  await expect(choice.getByText("必須", { exact: true })).toHaveCount(0)
  await expect(rating.getByText("任意", { exact: true })).toHaveCount(0)
  await expect(clearRating).toBeDisabled()
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      if (width < 640)
        expect((await select.boundingBox())?.width).toBeGreaterThan(
          width * 0.75,
        )
      const options = await rating.locator("label").evaluateAll((labels) =>
        labels.map((label) => {
          const { x, y } = label.getBoundingClientRect()
          return { x, y }
        }),
      )
      expect(options).toHaveLength(7)
      if (width === 768) {
        expect(options[1].y).toBe(options[0].y)
        expect(options[1].x).toBeGreaterThan(options[0].x)
        expect(options[2].y).toBeGreaterThan(options[0].y)
        expect(options[2].x).toBe(options[0].x)
      } else if (width < 640) {
        expect(options[1].y).toBeGreaterThan(options[0].y)
      } else {
        expect(options.every((option) => option.y === options[0].y)).toBe(true)
      }
      await select.selectOption({ index: 1 })
      await rating.getByRole("radio").first().check()
      await select.selectOption({ label: "選択してください" })
      await select.scrollIntoViewIfNeeded()
      await expect(select).toBeInViewport({ ratio: 1 })
      await clearRating.scrollIntoViewIfNeeded()
      await expect(clearRating).toBeInViewport({ ratio: 1 })
      const before = await rating.boundingBox()
      expect((await clearRating.boundingBox())?.height).toBeGreaterThanOrEqual(
        44,
      )
      await clearRating.focus()
      await page.keyboard.press("Enter")
      await expect(clearRating).toBeDisabled()
      expect((await rating.boundingBox())?.height).toBe(before?.height)
      for (const [name, question] of [
        ["choice", choice],
        ["rating", rating],
      ] as const) {
        await question.screenshot({
          path: testInfo.outputPath(`${name}-${width}-${colorScheme}.png`),
        })
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await expect(select).toHaveValue("")
      await expect(rating.locator("input:checked")).toHaveCount(0)
    }
  }
  await page.emulateMedia({ colorScheme: "light" })
  await fillSurvey(page)
  await select.selectOption({ label: "選択してください" })
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(select).toBeFocused()
  await expect(
    choice.getByText("必須項目です。回答してください。"),
  ).toBeVisible()
  expect(
    (await localServices.state()).calls["/api/participant/survey"] ?? 0,
  ).toBe(0)
  await select.selectOption({ index: 1 })
  await rating.getByRole("radio").first().check()
  await rating
    .getByRole("button", { name: "選択を解除（未回答に戻す）" })
    .click()
  await expect(rating.locator("input:checked")).toHaveCount(0)
  await expect(rating.getByRole("button")).toBeDisabled()
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(rating).toBeVisible()
  await expect(rating.locator("input:checked")).toHaveCount(0)
  await fillSurvey(page)
  await rating.getByRole("button").click()
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of [
      "結果表示に戻る",
      "ブラウザー内の一時データを消去する",
    ]) {
      const button = page.getByRole("button", { name, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport({ ratio: 1 })
    }
  }
})

test("license index reaches model terms without expanding dependency groups", async ({
  page,
}) => {
  await page.goto("/license")
  const index = page.getByRole("navigation", { name: "ライセンスの目次" })
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await index.getByRole("link", { name: "使用モデル", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "使用モデルのライセンス" }),
    ).toBeInViewport()
    await index
      .getByRole("link", { name: "第三者のライセンス", exact: true })
      .click()
    const group = page.locator("summary").filter({ hasText: /^A–F（/ })
    await group.focus()
    await page.keyboard.press("Enter")
    const packageSummary = group
      .locator("..")
      .locator(":scope > div > details > summary")
      .first()
    await expect(packageSummary).toBeVisible()
    await packageSummary.focus()
    await page.keyboard.press("Enter")
    await expect(
      packageSummary.locator("..").locator("pre").first(),
    ).toBeVisible()
    await page.keyboard.press("Enter")
    await group.focus()
    await page.keyboard.press("Enter")
    await expect(packageSummary).toBeHidden()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})

test("canceling document clear and removal preserves input before explicit confirmation", async ({
  page,
}) => {
  await openDocuments(page)
  await page.getByRole("button", { name: "+ 書類を追加", exact: true }).click()
  await documentInput(page).fill(DOCUMENT_TEXT)
  const clear = page.getByRole("button", { name: "本文をクリア", exact: true })
  const remove = page
    .getByRole("tabpanel")
    .getByRole("button", { name: / を削除$/ })
  const tabs = page.getByRole("tablist", { name: "申請書類" }).getByRole("tab")
  const originalCount = await tabs.count()
  for (const button of [clear, remove]) {
    page.once("dialog", (dialog) => dialog.dismiss())
    await button.click()
    await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
    await expect(tabs).toHaveCount(originalCount)
  }
  page.once("dialog", (dialog) => dialog.accept())
  await clear.click()
  await expect(documentInput(page)).toHaveValue("")
  await documentInput(page).fill(DOCUMENT_TEXT)
  page.once("dialog", (dialog) => dialog.accept())
  await remove.click()
  await expect(tabs).toHaveCount(originalCount - 1)
})

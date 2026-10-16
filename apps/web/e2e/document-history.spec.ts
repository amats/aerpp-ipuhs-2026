import { readFile } from "node:fs/promises"
import { PDFDocument } from "pdf-lib"
import { readBrowserScope } from "../test-support/e2e/browser-state"
import {
  expect,
  openDocuments,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

test("failed admission on document history offers retry without reloading or discarding browser data", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  const scope = await readBrowserScope(page)
  if (!scope) throw new Error("Synthetic browser session required")
  const consentIds = (await localServices.state()).consentIds
  let interrupted = false
  await page.route("**/download", async (route) => {
    if (
      route.request().headers()["next-action"] &&
      route.request().postData()?.includes(scope) &&
      interrupted !== true
    ) {
      interrupted = true
      return route.abort("failed")
    }
    return route.continue()
  })
  await page.goto("/download")
  const retry = page.getByRole("button", {
    name: "セッションの確認を再試行",
    exact: true,
  })
  await expect(retry).toBeVisible()
  expect(interrupted).toBe(true)
  await expect(
    page.getByText("利用状態を確認しています。", { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", {
      name: "研究計画書：PDFをダウンロード",
      exact: true,
    }),
  ).toBeDisabled()
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-admission-probe", "retained")
    localStorage.setItem("protected-admission-probe", "retained")
  })
  await retry.click()
  await expect(
    page.getByRole("button", {
      name: "同意書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => ({
      document: document.documentElement.getAttribute("data-admission-probe"),
      storage: localStorage.getItem("protected-admission-probe"),
    })),
  ).toEqual({ document: "retained", storage: "retained" })
  expect((await localServices.state()).consentIds).toEqual(consentIds)
})

test("an outdated withdrawal page leaves document history usable after reload", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await page.goto("/withdraw")
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  let intercepted = false
  await page.route("**/withdraw", async (route) => {
    const request = route.request()
    if (!request.headers()["next-action"] || intercepted)
      return route.continue()
    const args = request.postDataJSON()
    if (
      Array.isArray(args) &&
      args.length === 3 &&
      args[0] === "participant@example.invalid" &&
      typeof args[2] === "string" &&
      /^[a-f0-9]{64}$/.test(args[2])
    ) {
      intercepted = true
      args[2] = "b".repeat(64)
      return route.continue({ postData: JSON.stringify(args) })
    }
    return route.continue()
  })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText(
      "研究文書が更新されました。画面を再読み込みしてから撤回を申請してください。",
      { exact: true },
    ),
  ).toBeVisible()
  expect(intercepted).toBe(true)
  expect((await localServices.state()).withdrawalHashes).toEqual([])

  await page.reload()
  await page.goto("/download")
  const history = page.getByRole("region", { name: "今回の同意・撤回" })
  await expect(history).toContainText("書類の版：v1.0")
  const [consent] = await Promise.all([
    page.waitForEvent("download"),
    history
      .getByRole("button", {
        name: "同意書の控え：PDFをダウンロード",
        exact: true,
      })
      .click(),
  ])
  const consentId = (await localServices.state()).consentIds.at(-1)
  expect(consent.suggestedFilename()).toBe(`AERPP-consent-${consentId}.pdf`)
  expect(await consent.failure()).toBeNull()
  expect((await localServices.state()).withdrawalHashes).toEqual([])
})

test("an existing session downloads exact consent history before and after withdrawal", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await page.goto("/download")
  const history = page.getByRole("region", { name: "今回の同意・撤回" })
  await expect(history).toContainText("書類の版：v1.0")
  const consentId = (await localServices.state()).consentIds.at(-1)
  const [consent] = await Promise.all([
    page.waitForEvent("download"),
    history
      .getByRole("button", {
        name: "同意書の控え：PDFをダウンロード",
        exact: true,
      })
      .click(),
  ])
  expect(consent.suggestedFilename()).toBe(`AERPP-consent-${consentId}.pdf`)
  const filename = await consent.path()
  if (filename === null) throw new Error("Synthetic consent download missing")
  const pdf = await PDFDocument.load(await readFile(filename))
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getForm().getFields()).toHaveLength(0)

  await page.goto("/withdraw")
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "同意を撤回する", exact: true }).click(),
  ])
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  await page.goto("/download")
  await expect(
    history.getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeVisible()
  const [retained] = await Promise.all([
    page.waitForEvent("download"),
    history
      .getByRole("button", {
        name: "同意書の控え：PDFをダウンロード",
        exact: true,
      })
      .click(),
  ])
  expect(retained.suggestedFilename()).toBe(consent.suggestedFilename())
  expect((await localServices.state()).consentIds).toEqual([consentId])
})

test("public documents and pending authentication do not assert accepted consent", async ({
  page,
}) => {
  await page.goto("/download")
  await expect(
    page.getByRole("heading", { name: "同意履歴・関連書類", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("このブラウザーでは同意履歴を確認できません", {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "研究計画書：PDFをダウンロード",
      exact: true,
    }),
  ).toBeDisabled()
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "説明文書：PDFをダウンロード", exact: true })
    .click()
  expect((await downloading).suggestedFilename()).toBe("AERPP-Explanation.pdf")
  await sendConsent(page)
  await page.goto("/download")
  await expect(
    page.getByText("メール認証待ちです", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "同意書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toHaveCount(0)
})

test("groups older consent and withdrawal records and downloads the selected original on a phone", async ({
  page,
  localServices,
}, testInfo) => {
  await openDocuments(page)
  await localServices.scenario({ documentHistory: "multiple" })
  await page.goto("/download")
  const current = page.getByRole("region", {
    name: "今回の同意・撤回",
    exact: true,
  })
  await expect(
    current.getByRole("button", {
      name: "同意書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    current.getByText("同意時と現在公開中の書類の版は同じです。", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    current.getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toHaveCount(0)
  const previous = page.getByRole("region", {
    name: "これまでの同意・撤回",
    exact: true,
  })
  const summary = previous.locator("summary").first()
  await expect(summary).toContainText("2026年8月1日")
  await expect(summary).toContainText("2026年8月2日")
  await expect(summary).toContainText("v0.9")
  const oldConsent = previous.getByRole("button", {
    name: "同意書の控え：PDFをダウンロード",
    exact: true,
  })
  await expect(oldConsent).toBeHidden()
  await summary.click()
  const downloading = page.waitForEvent("download")
  await oldConsent.click()
  expect((await downloading).suggestedFilename()).toBe(
    "AERPP-consent-older-consent.pdf",
  )
  await expect(
    previous.getByText("撤回時と現在公開中の書類の版は異なります。", {
      exact: false,
    }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("consent-history-desktop.png"),
    fullPage: true,
    animations: "disabled",
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: "dark" })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: testInfo.outputPath("consent-history-mobile-dark.png"),
    fullPage: true,
    animations: "disabled",
  })
})

for (const documentHistory of ["different", "same-version"] as const) {
  test(`document identity notices do not imply reconsent: ${documentHistory}`, async ({
    page,
    localServices,
  }) => {
    await openDocuments(page)
    const consentIds = (await localServices.state()).consentIds
    await localServices.scenario({ documentHistory })
    await page.goto("/download")
    const current = page.getByRole("region", {
      name: "今回の同意・撤回",
      exact: true,
    })
    await expect(
      current.getByText(
        documentHistory === "different"
          ? "同意時と現在公開中の書類の版は異なります。"
          : "版番号は同じですが、文書セットは異なります。",
        { exact: false },
      ),
    ).toBeVisible()
    await current
      .getByRole("link", { name: "現在公開中の書類を見る", exact: true })
      .click()
    await expect(page).toHaveURL(/#current-documents$/)
    await expect(
      page.getByRole("heading", { name: "現在公開中の書類", exact: true }),
    ).toBeInViewport()
    expect((await localServices.state()).consentIds).toEqual(consentIds)
  })
}

test("a history outage offers read-only retry while current public files remain available", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  const consentIds = (await localServices.state()).consentIds
  await localServices.scenario({ failDocumentHistory: true })
  await page.goto("/download")
  await expect(
    page.getByText(
      "同意履歴を取得できませんでした。時間をおいて再試行してください。",
      { exact: true },
    ),
  ).toBeVisible()
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "説明文書：PDFをダウンロード", exact: true })
    .click()
  expect((await downloading).suggestedFilename()).toBe("AERPP-Explanation.pdf")
  await localServices.scenario({})
  await page.getByRole("button", { name: "再試行", exact: true }).click()
  await expect(
    page.getByRole("button", {
      name: "同意書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeVisible()
  expect((await localServices.state()).consentIds).toEqual(consentIds)
})

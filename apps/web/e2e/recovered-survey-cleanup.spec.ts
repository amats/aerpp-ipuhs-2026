import {
  readRecoveredDraft,
  writeStoredResult,
} from "../test-support/e2e/browser-state"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  test,
} from "../test-support/e2e/fixtures"

test("recovered survey cleanup failure preserves acceptance, deletion guidance and later input", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  const completed = (await localServices.state()).analysisAttempts.find(
    (attempt) => attempt.outcome === "completed",
  ) as unknown as { analysisId: string }
  await writeStoredResult(page, null)
  await page.reload()
  const recovery = {
    recoveryId: "44444444-4444-4444-8444-444444444444",
    destination: "initial-survey" as const,
    analysisId: completed.analysisId,
  }
  await localServices.scenario({ recovery })
  const footer = page.getByRole("contentinfo")
  await footer
    .getByText("研究責任者に復旧を依頼した方へ", { exact: true })
    .click()
  page.once("dialog", (dialog) => dialog.accept())
  await footer
    .getByRole("link", { name: "研究責任者の復旧許可を適用", exact: true })
    .click()
  await page
    .getByRole("button", { name: "復旧許可を確認して進む", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
  await localServices.scenario({ recovery, recoveryConsumed: true })
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await fillSurvey(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    let sawDraft = false
    let aborted = false
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key)
      if (key === "state" && value.recoveredSurvey?.value !== null)
        sawDraft = true
      if (
        key === "state" &&
        sawDraft &&
        !aborted &&
        value.recoveredSurvey?.value === null
      ) {
        aborted = true
        request.addEventListener("success", () => this.transaction.abort())
      }
      return request
    }
  })
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  expect((await readRecoveredDraft(page)) !== null).toBe(true)
  expect((await localServices.state()).surveyHashes.length).toBe(1)
  // A separate reload reproduces the durable leftover without clearing the
  // original page's in-memory flag, so the second assertion tests the next flow.
  const reloaded = await page.context().newPage()
  await reloaded.goto("/")
  await expect(
    reloaded.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  await expect(
    reloaded.getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    }),
  ).toBeEnabled()
  expect((await readRecoveredDraft(reloaded)) !== null).toBe(true)
  await reloaded.close()
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "アンケートの再送信は不要です" }),
  ).toBeVisible()
  await page
    .getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    })
    .click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  expect(await readRecoveredDraft(page)).toBeNull()
  await documentInput(page).fill(
    "Synthetic follow-up document for cleanup-boundary review. ".repeat(20),
  )
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await expect(page.getByRole("combobox").first()).toBeEnabled()
  expect((await localServices.state()).surveyHashes.length).toBe(1)
})

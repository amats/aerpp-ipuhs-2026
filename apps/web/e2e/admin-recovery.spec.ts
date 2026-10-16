import {
  readRecoveredDraft,
  readStoredResult,
  writeStoredResult,
} from "../test-support/e2e/browser-state"
import {
  analyzeDocument,
  expect,
  fillSurvey,
  test,
} from "../test-support/e2e/fixtures"

test("recovery can preempt a survey action whose upstream response remains held", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  await localServices.scenario({ holdSurvey: true })
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).surveyHashes.length)
    .toBe(1)
  await localServices.scenario({
    holdSurvey: true,
    recovery: {
      recoveryId: "66666666-6666-4666-8666-666666666666",
      destination: "initial-document",
    },
  })
  await page.goto("/recovery")
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(
    page.getByRole("heading", {
      name: "研究責任者の許可による復旧",
      level: 2,
      exact: true,
    }),
  ).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await page
    .getByRole("button", { name: "復旧許可を確認して進む", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
  expect(await readStoredResult(page)).toBeNull()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("pending recovery interrupts questionnaire dispatch and survives a lost reset response", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  const recovery = {
    recoveryId: "55555555-5555-4555-8555-555555555555",
    destination: "initial-document" as const,
  }
  await localServices.scenario({ recovery })
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(page).toHaveURL(/\/recovery$/)
  expect((await localServices.state()).surveyHashes).toHaveLength(0)
  expect(await readStoredResult(page)).toBeTruthy()
  let dropped = false
  await page.route("**/api/admin-recovery", async (route) => {
    if (route.request().postDataJSON().intent === "begin" && dropped !== true) {
      dropped = true
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort()
    } else await route.continue()
  })
  page.once("dialog", (dialog) => dialog.accept())
  await page
    .getByRole("button", { name: "復旧許可を確認して進む", exact: true })
    .click()
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "復旧手続きの完了を確認できませんでした" }),
  ).toBeVisible()
  // Even a direct return cannot dispatch a new consent before cleanup finishes.
  await page.goto("/")
  await expect(page).toHaveURL(/\/recovery$/)
  page.once("dialog", (dialog) => dialog.accept())
  await page
    .getByRole("button", { name: "復旧許可を確認して進む", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
  expect(await readStoredResult(page)).toBeNull()
  expect(await readRecoveredDraft(page)).toBeNull()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

for (const destination of [
  "initial-document",
  "initial-survey",
  "follow-up-document",
] as const) {
  test(`confirmed ${destination} resumes after recovery mail response loss and reload`, async ({
    page,
    localServices,
  }) => {
    await analyzeDocument(page)
    const original = (await localServices.state()).analysisAttempts.find(
      (attempt) => attempt.outcome === "completed",
    )
    if (!original) throw new Error("Expected original completed analysis")
    const recovery = {
      recoveryId: "88888888-8888-4888-8888-888888888888",
      destination,
      ...(destination === "initial-survey"
        ? { analysisId: original.analysisId }
        : {}),
    }
    await localServices.scenario({ recovery, failConsentOnce: true })
    await page.goto("/recovery")
    page.once("dialog", (dialog) => dialog.accept())
    await page
      .getByRole("button", { name: "復旧許可を確認して進む", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "承諾書", exact: true }),
    ).toBeVisible()
    async function fillConsent() {
      await page
        .getByRole("textbox", { name: "メールアドレス", exact: true })
        .fill("participant@example.invalid")
      for (const checkbox of await page.getByRole("checkbox").all())
        await checkbox.check()
    }
    await fillConsent()
    await page.getByRole("button", { name: "同意する", exact: true }).click()
    await expect(
      page
        .getByText("メールの送信結果を確認できませんでした。", { exact: false })
        .first(),
    ).toBeVisible()
    const before = await localServices.state()
    const consentId = before.consentIds.at(-1)
    const requestHash = before.consentHashes.at(-1)
    await localServices.scenario({ recovery, recoveryConsumed: true })
    await page.reload()
    await fillConsent()
    await expect(
      page.getByRole("button", { name: "同意する", exact: true }),
    ).toBeEnabled()
    await page.getByRole("button", { name: "同意する", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "メールアドレス認証を行う" }),
    ).toBeVisible()
    const after = await localServices.state()
    expect(after.consentHashes).toHaveLength(before.consentHashes.length + 1)
    expect(after.consentHashes.at(-1)).toBe(requestHash)
    expect(after.consentIds.at(-1)).toBe(consentId)
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await expect(
      page.getByRole("heading", {
        name:
          destination === "initial-survey"
            ? "アンケートの回答と送信"
            : "倫理申請書類の解析を準備する",
      }),
    ).toBeVisible()
    if (destination === "initial-survey") {
      await fillSurvey(page)
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "ご協力ありがとうございました" }),
      ).toBeVisible()
    }
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  })

  test(`administrator recovery requires renewed consent and opens ${destination}`, async ({
    page,
    localServices,
  }) => {
    await analyzeDocument(page)
    const original = (await localServices.state()).analysisAttempts.find(
      (attempt) => attempt.outcome === "completed",
    ) as unknown as { analysisId: string }
    if (!original?.analysisId) throw new Error("Expected original analysis")
    if (destination === "initial-document") {
      await page
        .getByRole("button", { name: "アンケートを開く", exact: true })
        .click()
      await fillSurvey(page)
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "ご協力ありがとうございました" }),
      ).toBeVisible()
    }
    await writeStoredResult(page, null)
    await page.reload()
    const recovery = {
      recoveryId: "44444444-4444-4444-8444-444444444444",
      destination,
      ...(destination === "initial-survey"
        ? { analysisId: original.analysisId }
        : {}),
    }
    await localServices.scenario({ recovery })
    if (destination === "follow-up-document") await page.goto("/download")
    const footer = page.getByRole("contentinfo")
    const recoveryPanel = footer.locator("details")
    await expect(recoveryPanel).not.toHaveAttribute("open", "")
    await footer
      .getByText("研究責任者に復旧を依頼した方へ", { exact: true })
      .click()
    await footer
      .getByRole("link", { name: "研究責任者の復旧許可を適用", exact: true })
      .click()
    await expect(page).toHaveURL(/\/recovery$/)
    const applyRecovery = page.getByRole("button", {
      name: "復旧許可を確認して進む",
      exact: true,
    })
    page.once("dialog", (dialog) => dialog.dismiss())
    await applyRecovery.click()
    await expect(
      page.getByRole("heading", { name: "承諾書", exact: true }),
    ).toHaveCount(0)
    await expect(applyRecovery).toBeEnabled()
    page.once("dialog", (dialog) => dialog.accept())
    await applyRecovery.click()
    await expect(page).toHaveURL(/\/$/)
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
    if (destination === "initial-survey") {
      await page
        .getByRole("button", { name: "メールアドレスを訂正する", exact: true })
        .click()
      await expect(
        page.getByText("復旧用の認証手続きが進んでいます。", { exact: false }),
      ).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "メールアドレス認証を行う" }),
      ).toBeVisible()
    }
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    if (destination !== "initial-survey") {
      await expect(
        page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
      ).toBeVisible()
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
      ).toBeVisible()
      if (destination === "initial-document") {
        await expect(
          page.getByText("Follow up Session", { exact: true }),
        ).toHaveCount(0)
        expect((await localServices.state()).surveyHashes).toHaveLength(1)
      }
    } else {
      await expect(
        page.getByRole("heading", { name: "アンケートの回答と送信" }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "結果表示に戻る", exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByRole("button", { name: "解析を開始する", exact: true }),
      ).toHaveCount(0)
      await localServices.scenario({
        recovery,
        recoveryConsumed: true,
        failSurveyOnce: true,
      })
      await fillSurvey(page)
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByText("送信を試みた回答を保持しています。", { exact: false }),
      ).toBeVisible()
      await expect
        .poll(async () => (await localServices.state()).surveyHashes.length)
        .toBe(1)
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "アンケートの送信に失敗しました" }),
      ).toBeVisible()
      const stored = await readRecoveredDraft(page)
      expect(stored).toBeTruthy()
      expect(stored).not.toContain("架空の回答")
      await localServices.restartWeb()
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "アンケートの回答と送信" }),
      ).toBeVisible()
      await expect(
        page.getByText("送信を試みた回答を保持しています。", { exact: false }),
      ).toBeVisible()
      await expect(page.getByRole("combobox").first()).toBeDisabled()
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "ご協力ありがとうございました" }),
      ).toBeVisible()
      expect(await readRecoveredDraft(page)).toBeNull()
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "ご協力ありがとうございました" }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "結果表示に戻る", exact: true }),
      ).toHaveCount(0)
      await page
        .getByRole("button", { name: "書類の準備へ進む", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
      ).toBeVisible()
      await expect(
        page.getByText("Follow up Session", { exact: true }),
      ).toBeVisible()
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
      ).toBeVisible()
      const state = await localServices.state()
      expect(state.surveyHashes).toHaveLength(2)
      expect(new Set(state.surveyHashes).size).toBe(1)
    }
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  })
}

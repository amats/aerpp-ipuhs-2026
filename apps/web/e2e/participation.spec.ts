import { readFile } from "node:fs/promises"
import JSZip from "jszip"
import {
  readStoredResult,
  writeStoredResult,
} from "../test-support/e2e/browser-state"
import { DOCUMENT_TEXT, RESULT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  openConsent,
  openDocuments,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

test("analysis admission remains authoritative when eligibility changes after readiness", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  const before = await localServices.state()
  expect(before.calls["/api/participant/participation-state"]).toBeGreaterThan(
    0,
  )
  expect(before.calls["/api/participant/participation-events"]).toBe(1)
  await localServices.scenario({ initialSurveyAcceptedBeforeAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("Follow up Session", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(page.getByText("Step 7 / 8", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("combobox", { name: "あなたの所属を教えてください" }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("group", {
      name: "今回の利用は、倫理申請書類の作成や確認に役立ったと思う",
    }),
  ).toBeVisible()
  const after = await localServices.state()
  expect(after.calls["/api/participant/verify-authentication"]).toBe(
    before.calls["/api/participant/verify-authentication"] + 1,
  )
  expect(
    after.analysisAttempts.filter((attempt) => attempt.outcome === "started"),
  ).toHaveLength(1)
  await page.reload()
  await expect(
    page.getByText("Follow up Session", { exact: true }),
  ).toBeVisible()
})

for (const appearance of [
  "desktop-light",
  "mobile-light",
  "mobile-dark",
] as const) {
  test(`overview, explanation and consent round trips preserve draft and focus (${appearance})`, async ({
    page,
    localServices,
  }, testInfo) => {
    if (appearance !== "desktop-light") {
      await page.setViewportSize({
        width: appearance === "mobile-light" ? 320 : 390,
        height: 844,
      })
      await page.emulateMedia({
        colorScheme: appearance === "mobile-dark" ? "dark" : "light",
      })
    }
    const progress = page.getByRole("navigation", { name: "進行中のステップ" })
    async function checkStep(step: number, title: string) {
      const heading = page.getByRole("heading", { name: title, exact: true })
      await expect(heading).toBeVisible()
      await expect(progress.locator('[aria-current="step"]')).toHaveAttribute(
        "aria-label",
        new RegExp(`^Step ${step}:`),
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      if (step !== 1) await expect(heading).toBeFocused()
    }

    await page.goto("/")
    await checkStep(1, "このシステムについて")
    await expect(
      page.getByRole("heading", { name: "このシステムについて", exact: true }),
    ).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath(`${appearance}-overview.png`),
      fullPage: true,
    })
    await page.getByRole("button", { name: "全ステップを閉じる" }).click()
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await checkStep(2, "研究へのご参加について（研究の説明）")
    await page.screenshot({
      path: testInfo.outputPath(`${appearance}-explanation.png`),
      fullPage: true,
    })
    await page.getByRole("button", { name: "同意画面へ進む" }).click()
    await checkStep(3, "承諾書")
    const email = page.getByRole("textbox", {
      name: "メールアドレス",
      exact: true,
    })
    await email.fill("participant@example.invalid")
    await page.getByRole("checkbox").first().check()
    await page.screenshot({
      path: testInfo.outputPath(`${appearance}-consent.png`),
      fullPage: true,
    })
    await page.getByRole("button", { name: "説明に戻る" }).click()
    await checkStep(2, "研究へのご参加について（研究の説明）")
    await page.getByRole("button", { name: "概要に戻る" }).click()
    await expect(
      page.getByRole("heading", { name: "このシステムについて", exact: true }),
    ).toBeFocused()
    await checkStep(1, "このシステムについて")
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await page.getByRole("button", { name: "同意画面へ進む" }).click()
    await checkStep(3, "承諾書")
    await expect(email).toHaveValue("participant@example.invalid")
    await expect(page.getByRole("checkbox").first()).toBeChecked()
    await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked()
    await expect(
      page.getByRole("button", { name: "同意する", exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole("button", { name: "全ステップを表示" }),
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      (await localServices.state()).calls["/api/participant/send-magic-link"] ??
        0,
    ).toBe(0)
  })
}

test("consent validation and draft survive auxiliary-route navigation", async ({
  page,
}) => {
  await openConsent(page)
  const email = page.getByRole("textbox", {
    name: "メールアドレス",
    exact: true,
  })
  const submit = page.getByRole("button", { name: "同意する", exact: true })
  await expect(submit).toBeDisabled()
  await email.fill("participant@example.invalid")
  await page.getByRole("checkbox").first().check()
  await page.getByRole("link", { name: "ライセンス情報", exact: true }).click()
  await expect(page).toHaveURL(/\/license$/)
  await expect(
    page.getByRole("heading", { name: "第三者のライセンス・著作権表示" }),
  ).toBeVisible()
  const fontNoticeTitle = page.getByText(
    "Noto Sans JP — SIL Open Font License 1.1",
    { exact: true },
  )
  await fontNoticeTitle.click()
  await expect(
    page
      .locator("details")
      .filter({ has: fontNoticeTitle })
      .locator("pre")
      .filter({ hasText: "SIL OPEN FONT LICENSE Version 1.1" }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", {
      name: "Health AI Developer Foundations Terms of Use",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    "https://developers.google.com/health-ai-developer-foundations/terms",
  )
  await page.goBack()
  await expect(email).toHaveValue("participant@example.invalid")
  await expect(page.getByRole("checkbox").first()).toBeChecked()
  await expect(submit).toBeDisabled()
})

test("pending authentication blocks withdrawal and server cooldown resists a changed browser clock", async ({
  page,
  localServices,
}) => {
  // Preserve real navigation timing so reload retains the current tab identity.
  const advanceResendClock = () =>
    page.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 61_000
    })
  await sendConsent(page)
  await page.getByRole("link", { name: "同意の撤回", exact: true }).click()
  await expect(
    page.getByText("同意の撤回はメール認証の完了後", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "同意を撤回する", exact: true }),
  ).toHaveCount(0)
  expect(
    (await localServices.state()).calls[
      "/api/participant/withdraw-participation"
    ] ?? 0,
  ).toBe(0)
  await page.getByRole("link", { name: "解析ステップ", exact: true }).click()
  const resend = page.getByRole("button", { name: /^認証メールを再送/ })
  await expect(resend).toBeDisabled()
  await advanceResendClock()
  await expect(resend).toBeEnabled()
  await resend.click()
  await expect(
    page.getByText(
      "送信回数の上限に達したか、前回の送信から60秒経過していません。",
      { exact: false },
    ),
  ).toBeVisible()
  await expect(resend).toBeDisabled()
  expect((await localServices.state()).consentHashes).toHaveLength(1)
  await page.reload()
  await expect(resend).toBeDisabled()
  await advanceResendClock()
  await expect(resend).toBeEnabled()
  await resend.click()
  await expect(
    page.getByText(
      "送信回数の上限に達したか、前回の送信から60秒経過していません。",
      { exact: false },
    ),
  ).toBeVisible()
  expect((await localServices.state()).consentHashes).toHaveLength(1)
})

test("authentication, file input, and document draft navigation work in a mobile viewport", async ({
  page,
  localServices,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openDocuments(page)
  await expect(
    page.getByRole("button", { name: "解析を開始する", exact: true }),
  ).toBeDisabled()
  await page.getByLabel("解析する書類ファイルを選択").setInputFiles({
    name: "synthetic-plan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(DOCUMENT_TEXT),
  })
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  await page
    .getByRole("link", { name: "同意履歴・関連書類", exact: true })
    .click()
  await expect(page).toHaveURL(/\/download$/)
  await page.goBack()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(
    (await localServices.state()).calls[
      "/api/participant/verify-authentication"
    ],
  ).toBe(1)
})

test("completed output survives metadata failure and retries without another analysis", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failMetadata: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "完了処理を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await expect(
    page.getByText("解析結果を保持しています。完了処理を再試行してください。", {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Word形式で保存", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "アンケートを開く", exact: true }),
  ).toHaveCount(0)
  await localServices.scenario({ failMetadata: false })
  await retry.click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  await page.reload()
  await expect(
    page.getByRole("button", { name: "アンケートを開く", exact: true }),
  ).toBeVisible()
})

test("completed analysis survives reload and exports its text to Word", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  expect((await localServices.state()).sawDocument).toBe(true)
  const attempts = (await localServices.state()).analysisAttempts
  expect(attempts.map((event) => event.outcome)).toEqual([
    "started",
    "completed",
    "presented",
  ])
  expect(attempts[0].documentGraphemeCounts).toEqual([
    Array.from(
      new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(
        DOCUMENT_TEXT,
      ),
    ).length,
  ])
  expect(attempts[0].consentId).toBe(
    (await localServices.state()).consentIds[0],
  )
  expect(attempts[1].consentId).toBe(attempts[0].consentId)
  await page.reload()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Word形式で保存", exact: true })
    .first()
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  expect(await download.failure()).toBeNull()
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const zip = await JSZip.loadAsync(await readFile(downloadedPath as string))
  const html = await zip.file("word/afchunk.mht")?.async("string")
  expect(html).toContain("保管期間を明記してください。")
  expect(html).toContain("【総合評価】<br>\n架空の研究計画を確認しました。")
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("survey retry after reload sends the same answers and retains the saved result", async ({
  page,
  localServices,
}) => {
  await localServices.scenario({ failSurveyOnce: true })
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  const submit = page.getByRole("button", {
    name: "アンケートを送信",
    exact: true,
  })
  await submit.click()
  await expect(page.getByRole("combobox").first()).toBeFocused()
  expect(
    (await localServices.state()).calls["/api/participant/survey"] ?? 0,
  ).toBe(0)
  await fillSurvey(page)
  await submit.click()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await expect(page.locator('[name="BG1"]')).toBeDisabled()
  await expect(
    page.locator('[data-survey-question="PE1"]').getByRole("button", {
      name: /^選択を解除/,
    }),
  ).toBeDisabled()
  await expect(submit).toBeEnabled()
  await page.reload()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole("radio").first()).toBeDisabled()
  await submit.click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  const state = await localServices.state()
  expect(state.surveyHashes).toHaveLength(2)
  expect(state.surveyHashes[0]).toBe(state.surveyHashes[1])
  expect(await readStoredResult(page)).not.toBeNull()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
})

test("an incorrect withdrawal email in another tab does not interrupt analysis", async ({
  page,
  context,
  localServices,
}) => {
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await localServices.scenario({ holdAnalysis: true })
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  const other = await context.newPage()
  await other.goto("/")
  await expect(other.locator("[data-analysis-animation]")).toBeVisible()
  await expect(
    other.getByRole("button", { name: "書類の準備へ戻る", exact: true }),
  ).toHaveCount(0)
  await other.getByRole("link", { name: "同意の撤回", exact: true }).click()
  await other
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("wrong@example.invalid")
  await other
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    other.getByText("登録済みメールアドレスと一致しません。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).withdrawalHashes).toHaveLength(0)
  await localServices.release()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("cookie loss automatically creates a fresh unauthenticated session", async ({
  page,
  context,
}) => {
  await openDocuments(page)
  await context.clearCookies()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeVisible()
})

test("analysis failure offers explicit recovery and retains document input", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await localServices.scenario({ failAnalysis: true })
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "ページを再読み込み", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "解析結果", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "書類の準備へ戻る", exact: true })
    .click()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  expect(
    (await localServices.state()).analysisAttempts.map(
      (event) => event.outcome,
    ),
  ).toEqual(["started", "failed"])
  await localServices.scenario({})
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(RESULT_TEXT.split("\n")[1], { exact: false }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(2)
})

test("result and survey navigation retains answers and permits another tab", async ({
  page,
  context,
  localServices,
}) => {
  await analyzeDocument(page)
  await expect(
    page.getByLabel("アンケートを別タブで開く", { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    }),
  ).toHaveCount(0)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  expect(context.pages()).toHaveLength(1)
  await expect(
    page.getByRole("heading", { name: "解析結果", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    }),
  ).toHaveCount(0)
  await fillSurvey(page)
  const answer = "結果へ戻っても保持する架空の回答"
  await page.locator("textarea").first().fill(answer)
  const extra = await context.newPage()
  await extra.goto("/#questionnaire=old-invitation")
  await expect(
    extra.getByRole("heading", { name: "解析結果", exact: true }),
  ).toBeVisible()
  await expect(
    extra.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toHaveCount(0)
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "解析結果", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(page.locator("textarea").first()).toHaveValue(answer)
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  expect(await readStoredResult(page)).not.toBeNull()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
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
  expect(await readStoredResult(page)).toBeNull()
  expect((await localServices.state()).calls["/api/participant/survey"]).toBe(1)
})

test("withdrawal in another tab retains staff guidance when analysis cancellation is unconfirmed without Web Locks", async ({
  page,
  context,
  localServices,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  )
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await localServices.scenario({ holdAnalysis: true, failCancellation: true })
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  const other = await context.newPage()
  await other.goto("/")
  await other.getByRole("link", { name: "同意の撤回", exact: true }).click()
  await other
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await other
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).withdrawalHashes.length)
    .toBe(1)
  await expect(
    other.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
  ).toBeVisible()
  await expect(
    other.getByText("研究責任者による復旧許可が必要です。", { exact: false }),
  ).toBeVisible()
  await localServices.release()
  expect(await readStoredResult(page)).toBeNull()
  await other.reload()
  await expect(
    other.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
  ).toBeVisible()
  await expect(
    other.getByText("研究責任者による復旧許可が必要です。", { exact: false }),
  ).toBeVisible()
})

for (const answered of [false, true]) {
  test(`completed analysis withdrawal retains staff guidance without a public reset (answered: ${answered})`, async ({
    page,
  }) => {
    await analyzeDocument(page)
    if (answered) {
      await page
        .getByRole("button", { name: "アンケートを開く", exact: true })
        .click()
      await fillSurvey(page)
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByText("Follow up Session", { exact: true }),
      ).toBeVisible()
    }
    await page.getByRole("link", { name: "同意の撤回", exact: true }).click()
    await page
      .getByRole("textbox", { name: "メールアドレス", exact: true })
      .fill("participant@example.invalid")
    await page
      .getByRole("button", { name: "同意を撤回する", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
    ).toBeVisible()
    await expect(
      page.getByText("研究責任者による復旧許可が必要です。", { exact: false }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText("データの消去が完了しました", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
    ).toBeVisible()
    const response = await page.goto("/reset")
    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole("button", { name: "初期化する", exact: true }),
    ).toHaveCount(0)
  })
}

for (const failed of [false, true]) {
  test(`withdrawal without completed analysis requires administrator recovery before a new initial flow (failed: ${failed})`, async ({
    page,
    localServices,
  }) => {
    await openDocuments(page)
    if (failed) {
      await localServices.scenario({ failAnalysis: true })
      await documentInput(page).fill(DOCUMENT_TEXT)
      await page
        .getByRole("button", { name: "解析を開始する", exact: true })
        .click()
      await expect
        .poll(async () =>
          (await localServices.state()).analysisAttempts.map(
            (attempt) => attempt.outcome,
          ),
        )
        .toContain("failed")
      await localServices.scenario({})
    }
    await page.getByRole("link", { name: "同意の撤回", exact: true }).click()
    await page
      .getByRole("textbox", { name: "メールアドレス", exact: true })
      .fill("participant@example.invalid")
    await page
      .getByRole("button", { name: "同意を撤回する", exact: true })
      .click()
    await expect(
      page.getByRole("heading", {
        name: "研究参加の撤回を受け付けました",
        exact: true,
      }),
    ).toBeVisible()
    await expect(page).toHaveURL("/")
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "support@example.invalid", exact: true }),
    ).toHaveAttribute("href", "mailto:support@example.invalid")
    await expect(
      page.getByRole("link", {
        name: "同意履歴・関連書類（同意撤回書の控え）",
        exact: true,
      }),
    ).toHaveAttribute("href", "/download")
    const recovery = {
      recoveryId: "44444444-4444-4444-8444-444444444444",
      destination: "initial-document" as const,
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
      page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
    ).toBeVisible()
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", {
        name: "ブラウザー内の一時データを消去する",
        exact: true,
      }),
    ).toHaveCount(0)
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await expect(
      page
        .getByRole("navigation", { name: "進行中のステップ" })
        .getByText("Step 7 / 8", { exact: true }),
    ).toBeVisible()
    await fillSurvey(page)
    await page
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await expect(
      page.getByText("Follow up Session", { exact: true }),
    ).toBeVisible()
    expect(new Set((await localServices.state()).consentIds).size).toBe(2)
  })
}

for (const view of ["result", "survey"] as const) {
  test(`follow-up deletion from ${view} confirms unsent answers and preserves them on cancel`, async ({
    page,
  }) => {
    await analyzeDocument(page)
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await fillSurvey(page)
    await page
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await page
      .getByRole("button", {
        name: "ブラウザー内の一時データを消去する",
        exact: true,
      })
      .click()
    await expect(
      page.getByText("ブラウザーを閉じて終了できます。", { exact: false }),
    ).toBeVisible()
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await page.locator("textarea").first().fill("未送信の架空の回答")
    if (view === "result") {
      await page
        .getByRole("button", { name: "結果表示に戻る", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "解析結果", exact: true }),
      ).toBeVisible()
    }
    const clear = page.getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    })
    await Promise.all([
      page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
      clear.click(),
    ])
    await expect(clear).toBeEnabled()
    if (view === "result")
      await page
        .getByRole("button", { name: "アンケートを開く", exact: true })
        .click()
    await expect(page.locator("textarea").first()).toHaveValue(
      "未送信の架空の回答",
    )
    if (view === "result") {
      await page
        .getByRole("button", { name: "結果表示に戻る", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "解析結果", exact: true }),
      ).toBeVisible()
    }
    expect(await readStoredResult(page)).not.toBeNull()
    await Promise.all([
      page.waitForEvent("dialog").then((dialog) => dialog.accept()),
      clear.click(),
    ])
    await expect(
      page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
    ).toBeVisible()
    expect(await readStoredResult(page)).toBeNull()
  })
}

test("consent captured before withdrawal is rejected until explicit reconfirmation", async ({
  page,
  localServices,
}) => {
  await openConsent(page)
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  const submit = page.getByRole("button", { name: "同意する", exact: true })
  await expect(submit).toBeEnabled()
  await localServices.scenario({ currentWithdrawalId: "new-withdrawal" })
  await submit.click()
  await expect(
    page.getByText(
      "参加状態が変更されました。再確認してから、同意項目を確認し直してください。",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(submit).toBeDisabled()
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked()
  expect(
    (await localServices.state()).calls["/api/participant/send-magic-link"],
  ).toBe(1)
  await page
    .getByRole("button", { name: "参加状態を再確認", exact: true })
    .click()
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "参加状態を確認しています" }),
  ).toHaveCount(0)
  await expect(submit).toBeDisabled()
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeVisible()
  expect(
    (await localServices.state()).calls["/api/participant/send-magic-link"],
  ).toBe(2)
})

test("consent retries after response loss and reload retain the original request", async ({
  page,
  localServices,
}) => {
  await openConsent(page)
  await localServices.scenario({ failConsentOnce: true })
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
      .getByText(
        "メールの送信結果を確認できませんでした。すでに送信されている可能性があります。通信状態を確認し、同じメールアドレスで再試行してください。",
        { exact: true },
      )
      .first(),
  ).toBeVisible()
  await page.reload()
  await fillConsent()
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
  const hashes = (await localServices.state()).consentHashes
  expect(hashes).toHaveLength(2)
  expect(new Set(hashes).size).toBe(1)
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
})

test("presentation acknowledgement is required before showing the stored result", async ({
  page,
  localServices,
}) => {
  await localServices.scenario({ failPresentation: true })
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "完了処理を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Word形式で保存", exact: true }),
  ).toBeDisabled()
  expect(await readStoredResult(page)).not.toBeNull()
  await localServices.scenario({ failPresentation: false })
  await retry.click()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("initial result loss keeps researcher guidance without allowing a second analysis", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await writeStoredResult(page, null)
  await page.reload()
  await expect(
    page.getByText("研究者にご連絡ください。", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "書類の準備へ戻る", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "解析を開始する", exact: true }),
  ).toHaveCount(0)
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

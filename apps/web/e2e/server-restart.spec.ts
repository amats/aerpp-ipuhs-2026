import { writeStoredResult } from "../test-support/e2e/browser-state"
import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  openDocuments,
  test,
} from "../test-support/e2e/fixtures"

test("server restart during inference records unavailable output and permits preparation without another model request", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  const state = await localServices.state()
  expect(state.calls["/v1/responses"]).toBe(1)
  expect(state.analysisAttempts.map((attempt) => attempt.outcome)).toEqual([
    "started",
    "unavailable",
  ])
})

test("server restart loses unpresented RAM output and automatically returns to preparation after loss acknowledgement", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  let blockResult = true
  await page.route("**/api/llm/analysis/result?*", async (route) => {
    if (blockResult && route.request().method() === "GET")
      return route.abort("failed")
    return route.continue()
  })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "接続を再確認", exact: true }),
  ).toBeVisible()
  await localServices.restartWeb()
  blockResult = false
  await page.getByRole("button", { name: "接続を再確認", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  const state = await localServices.state()
  expect(state.calls["/v1/responses"]).toBe(1)
  expect(state.analysisAttempts.map((attempt) => attempt.outcome)).toEqual([
    "started",
    "completed",
    "unavailable",
  ])
})

test("server restart after a confirmed failure removes prompt retry eligibility without running inference again", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toBeVisible()
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "書類の準備へ戻る", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toHaveCount(0)
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("server restart preserves the saved result and frozen survey payload for an identical retry", async ({
  page,
  localServices,
}) => {
  await localServices.scenario({ failSurveyOnce: true })
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  const submit = page.getByRole("button", {
    name: "アンケートを送信",
    exact: true,
  })
  await submit.click()
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
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await submit.click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  const state = await localServices.state()
  expect(state.calls["/v1/responses"]).toBe(1)
  expect(state.surveyHashes).toHaveLength(2)
  expect(new Set(state.surveyHashes).size).toBe(1)
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
})

test("server restart preserves accepted withdrawal and its fixed cleanup retry", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await page.goto("/withdraw")
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await localServices.scenario({ withdrawalFailure: "pending" })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await localServices.scenario({})
  await page
    .getByRole("button", { name: "データ削除の再試行", exact: true })
    .click()
  await expect(
    page.getByRole("heading", {
      name: "研究参加の撤回を受け付けました",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("研究責任者による復旧許可が必要です。", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  const hashes = (await localServices.state()).withdrawalHashes
  expect(hashes.length).toBeGreaterThan(1)
  expect(new Set(hashes).size).toBe(1)
})

test("server restart cannot recover a presented initial result lost from browser storage", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await writeStoredResult(page, null)
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page
      .getByText(
        "初回解析の結果を失った場合は、再解析せず研究者にご連絡ください。",
        { exact: false },
      )
      .first(),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "書類の準備へ戻る", exact: true }),
  ).toHaveCount(0)
  const state = await localServices.state()
  expect(state.calls["/v1/responses"]).toBe(1)
  expect(state.analysisAttempts.map((attempt) => attempt.outcome)).toEqual([
    "started",
    "completed",
    "presented",
  ])
})

test("server restart during survey dispatch releases dead ownership and retries identical uncertain answers", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await localServices.scenario({ holdSurvey: true })
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  const submit = page.getByRole("button", {
    name: "アンケートを送信",
    exact: true,
  })
  await submit.click()
  await expect
    .poll(async () => (await localServices.state()).surveyHashes.length)
    .toBe(1)
  await localServices.restartWeb()
  await page.reload()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await localServices.scenario({})
  await submit.click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  const hashes = (await localServices.state()).surveyHashes
  expect(hashes).toHaveLength(2)
  expect(new Set(hashes).size).toBe(1)
})

test("redelivers only the durable operational outcome after Web stops before normal acknowledgment", async ({
  page,
  localServices,
}) => {
  test.setTimeout(90_000)
  await openDocuments(page)
  await localServices.scenario({ failTerminal: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "完了処理を再試行", exact: true }),
  ).toBeEnabled()
  const before = await localServices.state()
  const terminal = before.analysisAttempts.findLast(
    (attempt) => attempt.outcome === "completed",
  )
  if (!terminal) throw new Error("Missing synthetic terminal")
  await localServices.restartWeb()
  await expect
    .poll(
      async () =>
        (await localServices.state()).analysisAuditOutcomes.find(
          (event) => event.analysisId === terminal.analysisId,
        ),
      { timeout: 60_000, intervals: [250, 1000] },
    )
    .toMatchObject({ analysisId: terminal.analysisId, outcome: "completed" })
  const after = await localServices.state()
  const audit = after.analysisAuditOutcomes.find(
    (event) => event.analysisId === terminal.analysisId,
  )
  expect(Object.keys(audit ?? {}).sort()).toEqual([
    "analysisId",
    "clientId",
    "consentId",
    "endedAtMs",
    "outcome",
    "pseudonym",
    "serverId",
  ])
  expect(after.analysisAttempts).toEqual(before.analysisAttempts)
  expect(after.calls["/v1/responses"]).toBe(1)
})

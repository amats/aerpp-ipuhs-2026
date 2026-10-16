import { readStoredResult } from "../test-support/e2e/browser-state"
import {
  analyzeDocument,
  expect,
  fillSurvey,
  test,
} from "../test-support/e2e/fixtures"

test("completion fallback preserves frozen answers and reload retries the original survey", async ({
  page,
  context,
  localServices,
}) => {
  const releaseRead = Promise.withResolvers<void>()
  const releaseSubmit = Promise.withResolvers<void>()
  let readHeld = false
  let submitHeld = false
  let holdSubmit = true
  const other = await context.newPage()
  // A lost optional RAM acknowledgement leaves the original result retrievable.
  await page.route("**/api/llm/analysis/result?*", async (route) => {
    if (route.request().method() === "DELETE") return route.abort()
    return route.continue()
  })
  try {
    await analyzeDocument(page)
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await fillSurvey(page)
    for (const textbox of await page.getByRole("textbox").all())
      await textbox.fill("synthetic original answer")
    await other.route("**/", async (route) => {
      if (!route.request().headers()["next-action"]) return route.continue()
      const response = await route.fetch()
      if (
        !readHeld &&
        (await response.text()).includes('"result":{"analysisId":')
      ) {
        readHeld = true
        await releaseRead.promise
      }
      await route.fulfill({ response })
    })
    await other.goto("/")
    await expect.poll(() => readHeld).toBe(true)
    await localServices.scenario({ failSurveyOnce: true })
    await page.route("**/", async (route) => {
      const body = route.request().postData() ?? ""
      if (
        holdSubmit === true &&
        body.includes("synthetic original answer") &&
        !body.includes('"text":')
      ) {
        submitHeld = true
        await releaseSubmit.promise
      }
      await route.continue()
    })
    await page
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await expect.poll(() => submitHeld).toBe(true)
    const frozen = await readStoredResult(page)
    expect(frozen).not.toBeNull()
    releaseRead.resolve()
    await expect(
      other.getByRole("button", { name: "ページを再読み込み", exact: true }),
    ).toBeVisible()
    await expect(
      other.getByText("解析が終了しました。", { exact: true }),
    ).toHaveCount(0)
    expect((await readStoredResult(page)) === frozen).toBe(true)
    expect((await localServices.state()).surveyHashes).toHaveLength(0)
    await other
      .getByRole("button", { name: "ページを再読み込み", exact: true })
      .click()
    await expect(
      other.getByRole("heading", { name: "アンケートの回答と送信" }),
    ).toBeVisible()
    await expect(other.getByRole("combobox").first()).toBeDisabled()
    holdSubmit = false
    releaseSubmit.resolve()
    await expect(
      page.getByRole("alert").filter({ hasText: "アンケートの送信に失敗" }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "アンケートの回答と送信" }),
    ).toBeVisible()
    await expect(page.getByRole("combobox").first()).toBeDisabled()
    for (const textbox of await page.getByRole("textbox").all())
      await expect(textbox).toHaveValue("synthetic original answer")
    await page
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "ご協力ありがとうございました" }),
    ).toBeVisible()
    await expect
      .poll(async () => (await localServices.state()).surveyHashes.length)
      .toBe(2)
    const state = await localServices.state()
    expect(state.surveyHashes[1]).toBe(state.surveyHashes[0])
    expect(state.calls["/v1/responses"]).toBe(1)
  } finally {
    releaseRead.resolve()
    releaseSubmit.resolve()
    await page.unrouteAll({ behavior: "wait" })
    await other.unrouteAll({ behavior: "wait" })
  }
})

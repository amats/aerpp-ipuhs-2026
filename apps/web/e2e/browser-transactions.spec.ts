import type { Route } from "@playwright/test"
import { readStoredResult } from "../test-support/e2e/browser-state"
import {
  analyzeDocument,
  expect,
  fillSurvey,
  test,
} from "../test-support/e2e/fixtures"

test("concurrent survey freezes commit one retry payload and reload resends identical answers", async ({
  page,
  context,
  localServices,
}) => {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await fillSurvey(page)
  const other = await context.newPage()
  await other.goto("/")
  await other
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    other.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await fillSurvey(other)
  for (const textbox of await page.getByRole("textbox").all())
    await textbox.fill("synthetic answer A")
  for (const textbox of await other.getByRole("textbox").all())
    await textbox.fill("synthetic answer B")
  const original = await readStoredResult(page)
  await localServices.scenario({ failSurveyOnce: true })
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let seals = 0
  const holdSeal = async (route: Route) => {
    if (!route.request().headers()["next-action"]) return route.continue()
    const response = await route.fetch()
    if ((await response.text()).includes('"sealedResult":')) {
      seals += 1
      if (seals === 2) ready.resolve()
      await release.promise
    }
    await route.fulfill({ response })
  }
  await page.route("**/", holdSeal)
  await other.route("**/", holdSeal)
  try {
    await Promise.all(
      [page, other].map((tab) =>
        tab
          .getByRole("button", { name: "アンケートを送信", exact: true })
          .click(),
      ),
    )
    await ready.promise
    expect(await readStoredResult(page)).toBe(original)
    release.resolve()
    await expect
      .poll(async () => (await localServices.state()).surveyHashes.length)
      .toBe(1)
    for (const tab of [page, other]) {
      await expect(
        tab
          .getByRole("button", { name: "ページを再読み込み", exact: true })
          .or(
            tab
              .getByRole("alert")
              .filter({ hasText: "アンケートの送信に失敗" }),
          ),
      ).toBeVisible()
    }
    const pageLost = await page
      .getByRole("button", { name: "ページを再読み込み", exact: true })
      .count()
    const otherLost = await other
      .getByRole("button", { name: "ページを再読み込み", exact: true })
      .count()
    expect(pageLost + otherLost).toBe(1)
    const retrying = pageLost === 1 ? page : other
    await retrying.reload()
    await expect(
      retrying.getByText("送信を試みた回答を保持しています。", {
        exact: false,
      }),
    ).toBeVisible()
    await expect(retrying.getByRole("combobox").first()).toBeDisabled()
    await retrying
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await expect(
      retrying.getByRole("heading", { name: "ご協力ありがとうございました" }),
    ).toBeVisible()
    const hashes = (await localServices.state()).surveyHashes
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).toBe(hashes[1])
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
    await other.unrouteAll({ behavior: "wait" })
  }
})

test("an aborted answer transaction does not dispatch even after its put request succeeds", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await fillSurvey(page)
  const original = await readStoredResult(page)
  await page.evaluate((original) => {
    const put = IDBObjectStore.prototype.put
    let aborted = false
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key)
      if (
        !aborted &&
        key === "state" &&
        value.analysisResult.value !== original
      ) {
        aborted = true
        request.addEventListener("success", () => this.transaction.abort())
      }
      return request
    }
  }, original)
  const submit = page.getByRole("button", {
    name: "アンケートを送信",
    exact: true,
  })
  await submit.click()
  await expect(
    page.getByRole("alert").filter({ hasText: "送信していません" }),
  ).toBeVisible()
  expect(
    (await localServices.state()).calls["/api/participant/survey"] ?? 0,
  ).toBe(0)
  expect(await readStoredResult(page)).toBe(original)
  await expect(page.getByRole("combobox").first()).toBeEnabled()
  await submit.click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/api/participant/survey"]).toBe(1)
})

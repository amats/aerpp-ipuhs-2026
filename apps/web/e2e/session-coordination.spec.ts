import { readBrowserScope } from "../test-support/e2e/browser-state"
import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  openDocuments,
  test,
} from "../test-support/e2e/fixtures"

test("failed admission can be retried without reloading or deleting stored data", async ({
  page,
}) => {
  let interrupted = false
  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-action"] && interrupted !== true) {
      const scope = await readBrowserScope(page)
      if (scope && route.request().postData()?.includes(scope)) {
        interrupted = true
        return route.abort("failed")
      }
    }
    return route.continue()
  })
  await page.goto("/")
  const retry = page.getByRole("button", {
    name: "セッションの確認を再試行",
    exact: true,
  })
  await expect(retry).toBeVisible()
  expect(interrupted).toBe(true)
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-admission-probe", "retained")
    localStorage.setItem("protected-admission-probe", "retained")
  })
  await retry.click()
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      document.documentElement.getAttribute("data-admission-probe"),
    ),
  ).toBe("retained")
  expect(
    await page.evaluate(() =>
      localStorage.getItem("protected-admission-probe"),
    ),
  ).toBe("retained")
})

test("simultaneous first tabs share one credential and release the admission lock", async ({
  page,
  context,
}) => {
  const other = await context.newPage()
  await Promise.all([page.goto("/"), other.goto("/")])
  for (const tab of [page, other]) {
    await expect(
      tab.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible()
  }
  const scopes = await Promise.all(
    [page, other].map((tab) => readBrowserScope(tab)),
  )
  expect(scopes[0]).not.toBeNull()
  expect(scopes[1]).toBe(scopes[0])
  expect(
    (await context.cookies())
      .filter((cookie) => cookie.name.startsWith("aerpp-session-"))
      .map((cookie) => cookie.name),
  ).toEqual([`aerpp-session-${scopes[0]}`])
  const locks = await page.evaluate(() => navigator.locks.query())
  expect(locks.held).toEqual([])
  expect(locks.pending).toEqual([])
  for (const tab of [page, other]) {
    await tab.getByRole("button", { name: "次に進む", exact: true }).click()
    await expect(
      tab.getByRole("button", { name: "同意画面へ進む" }),
    ).toBeVisible()
  }
})

test("tabs immediately share the saved result without awake requests", async ({
  page,
  context,
  localServices,
}) => {
  const awake: string[] = []
  context.on("request", (request) => {
    if (request.url().includes("/api/session-status")) awake.push(request.url())
  })
  await analyzeDocument(page)
  const other = await context.newPage()
  await other.goto("/")
  await expect(
    other.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  await page.close()
  await other.reload()
  await expect(
    other.getByRole("button", { name: "アンケートを開く", exact: true }),
  ).toBeVisible()
  expect(awake).toEqual([])
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("both tabs can reload during analysis without another inference", async ({
  page,
  context,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).sawDocument)
    .toBe(true)
  const observer = await context.newPage()
  await observer.goto("/")
  await expect(observer.locator("[data-analysis-animation]")).toBeVisible()
  await observer.reload()
  await expect(observer.locator("[data-analysis-animation]")).toBeVisible()
  await observer.close()
  await page.reload()
  const animation = page.locator("[data-analysis-animation]")
  await expect(animation).toBeVisible()
  await expect(animation).toHaveCSS("animation-name", "spin")
  const elapsed = page.getByText(/経過時間/)
  const before = await elapsed.textContent()
  await expect.poll(() => elapsed.textContent()).not.toBe(before)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(animation).toHaveCSS("animation-name", "none")
  expect((await localServices.state()).abortedAnalyses).toBe(0)
  await localServices.release()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  expect(
    (await localServices.state()).analysisAttempts.map(
      (event) => event.outcome,
    ),
  ).toEqual(["started", "completed", "presented"])
})

test("a stale result action prompts reload after another tab deletes the follow-up result", async ({
  page,
  context,
}) => {
  await analyzeDocument(page)
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
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  const other = await context.newPage()
  await other.goto("/")
  await other
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    other.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  other.once("dialog", (dialog) => dialog.accept())
  await other
    .getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    })
    .click()
  await expect(
    other.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Word形式で保存", exact: true })
    .first()
    .click()
  await expect(
    page.getByText("ページを再読み込み", { exact: false }).first(),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
})

test("result and survey navigation keeps the same hash in both tabs", async ({
  page,
  context,
}) => {
  await analyzeDocument(page)
  const cookieNames = (await context.cookies())
    .map((cookie) => cookie.name)
    .sort()
  const other = await context.newPage()
  await other.goto("/")
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await other
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    other.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toBeVisible()
  expect((await context.cookies()).map((cookie) => cookie.name).sort()).toEqual(
    cookieNames,
  )
})

for (const path of [
  "/debug",
  "/debug/home-flow",
  "/debug/alert-message",
  "/reset",
]) {
  test(`the ordinary environment does not expose ${path}`, async ({
    page,
    localServices,
  }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
    await expect(page.locator('footer a[href^="/debug"]')).toHaveCount(0)
    await expect(page.locator('footer a[href="/reset"]')).toHaveCount(0)
    expect((await localServices.state()).calls).toEqual({})
  })
}

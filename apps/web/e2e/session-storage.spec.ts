import type { Page } from "@playwright/test"
import { readBrowserContext } from "../test-support/e2e/browser-state"
import {
  currentSessionToken,
  expect,
  openConsent,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

async function prepareConsent(page: Page, email: string) {
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill(email)
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  await expect(
    page.getByRole("button", { name: "同意する", exact: true }),
  ).toBeEnabled()
}

test("intro navigation retains the draft and stamp without rewriting credentials", async ({
  page,
  context,
}) => {
  await openConsent(page)
  await prepareConsent(page, "participant@example.invalid")
  const credentials = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("aerpp-session-"),
  )
  expect(credentials).toHaveLength(1)
  expect(credentials[0].httpOnly).toBe(true)
  expect(credentials[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const firstNavigationResponse = page.waitForResponse((response) =>
    Boolean(response.request().headers()["next-action"]),
  )
  await page.getByRole("button", { name: "説明に戻る", exact: true }).click()
  // Read this completed navigation rather than a preparation response that
  // Playwright may discard before its asynchronous capture has finished.
  const token = (await (await firstNavigationResponse).text()).match(
    /"sessionToken":"([a-f0-9-]+:[a-f0-9]{64})"/,
  )?.[1]
  expect(token).toBeTruthy()
  await page.getByRole("button", { name: "概要に戻る", exact: true }).click()
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await page
    .getByRole("button", { name: "同意画面へ進む", exact: true })
    .click()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveValue("participant@example.invalid")
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).toBeChecked()
  await expect(
    page.getByRole("button", { name: "同意する", exact: true }),
  ).toBeEnabled()
  await expect.poll(() => currentSessionToken(page)).toBe(token)
  expect(
    (await context.cookies()).filter((cookie) =>
      cookie.name.startsWith("aerpp-session-"),
    ),
  ).toEqual(credentials)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).not.toContain("participant@example.invalid")
})

test("near-simultaneous consent with different emails sends only the current identity", async ({
  page,
  context,
  localServices,
}) => {
  await openConsent(page)
  await prepareConsent(page, "first@example.invalid")
  const other = await context.newPage()
  await openConsent(other)
  await prepareConsent(other, "second@example.invalid")
  await Promise.all([
    page.getByRole("button", { name: "同意する", exact: true }).click(),
    other.getByRole("button", { name: "同意する", exact: true }).click(),
  ])
  await expect(
    other.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "ページを再読み込み", exact: true }),
  ).toBeVisible()
  expect(
    (await localServices.state()).calls["/api/participant/send-magic-link"],
  ).toBe(1)
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
})

test("email correction is immediate but a new recipient cannot bypass the server interval", async ({
  page,
  localServices,
}) => {
  await sendConsent(page)
  await page
    .getByRole("button", { name: "メールアドレスを訂正する", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveValue("")
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked()
  await prepareConsent(page, "corrected@example.invalid")
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await expect(
    page
      .getByText(
        "送信回数の上限に達したか、前回の送信から60秒経過していません。",
        { exact: false },
      )
      .first(),
  ).toBeVisible()
  expect(
    (await localServices.state()).calls["/api/participant/send-magic-link"],
  ).toBe(1)
})

test("a delayed email-correction response cannot remove a newer tab's prepared identity", async ({
  page,
  context,
}) => {
  await sendConsent(page)
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const delivered = Promise.withResolvers<void>()
  await page.route("**/", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue()
    const response = await route.fetch()
    if (!(await response.text()).includes('"browserContext":null'))
      return route.fulfill({ response })
    ready.resolve()
    await release.promise
    await route.fulfill({ response })
    delivered.resolve()
  })
  try {
    await page
      .getByRole("button", { name: "メールアドレスを訂正する", exact: true })
      .click()
    await ready.promise
    const other = await context.newPage()
    await openConsent(other)
    await prepareConsent(other, "corrected@example.invalid")
    const storedContext = await readBrowserContext(other)
    expect(JSON.parse(storedContext ?? "{}").value).toBeTruthy()
    release.resolve()
    await delivered.promise
    await expect(
      page.getByRole("button", { name: "ページを再読み込み", exact: true }),
    ).toBeVisible()
    expect(await readBrowserContext(other)).toBe(storedContext)
    await expect(
      other.getByRole("button", { name: "同意する", exact: true }),
    ).toBeEnabled()
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

let database: Firestore
const recordId = "draft-protection-notice"
const savedContent = "保存済みの合成のお知らせ"

test.beforeAll(async () => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-admin-information" })
  await database.doc(`information/${recordId}`).set({
    content: savedContent,
    tone: "info",
    createdAt: new Date(),
    expireAt: new Date("2030-01-01T00:00:00Z"),
  })
})
test.afterAll(async () => {
  if (!database) return
  await database.doc(`information/${recordId}`).delete()
  await database.terminate()
})
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  await page.goto("/information")
})

test("switching to an existing notice and canceling an edit require explicit draft discard", async ({
  page,
}) => {
  const body = page.getByLabel("本文", { exact: true })
  const expiry = page.getByLabel("有効期限（指定タイムゾーン）", {
    exact: true,
  })
  const edit = page
    .locator("article")
    .filter({ hasText: recordId })
    .getByRole("button", { name: "編集", exact: true })
  await body.fill("未保存の新規入力")
  await expiry.fill("2031-01-01T12:00")
  page.once("dialog", (dialog) => dialog.dismiss())
  await edit.click()
  await expect(body).toHaveValue("未保存の新規入力")
  await expect(expiry).toHaveValue("2031-01-01T12:00")
  page.once("dialog", (dialog) => dialog.accept())
  await edit.click()
  await expect(body).toHaveValue(savedContent)
  await expect(page.getByText(/未保存の変更があります/)).toHaveCount(0)
  await body.fill("編集中の変更")
  page.once("dialog", (dialog) => dialog.dismiss())
  await page
    .getByRole("button", { name: "編集を取り消す", exact: true })
    .click()
  await expect(body).toHaveValue("編集中の変更")
  await body.fill(savedContent)
  await expect(page.getByText(/未保存の変更があります/)).toHaveCount(0)
  const dialogs: string[] = []
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type())
    await dialog.dismiss()
  })
  await page
    .getByRole("button", { name: "編集を取り消す", exact: true })
    .click()
  await expect(body).toHaveValue("")
  expect(dialogs).toEqual([])
})

test("drafts survive client navigation and history while reload requires browser confirmation", async ({
  page,
}) => {
  const body = page.getByLabel("本文", { exact: true })
  const navigate = (name: string) =>
    page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name, exact: true })
      .click()
  await body.fill("画面を移動しても保持する入力")
  await navigate("参加者")
  await expect(page).toHaveURL(/\/participant$/)
  await page.goBack()
  await expect(body).toHaveValue("画面を移動しても保持する入力")
  await page.goForward()
  await expect(page).toHaveURL(/\/participant$/)
  const dialogs: string[] = []
  page.once("dialog", async (dialog) => {
    dialogs.push(dialog.type())
    await dialog.dismiss()
  })
  await page.getByRole("button", { name: "リロード", exact: true }).click()
  await expect.poll(() => dialogs).toEqual(["beforeunload"])
  await navigate("お知らせ")
  await expect(body).toHaveValue("画面を移動しても保持する入力")
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "リロード", exact: true }).click()
  await expect(body).toHaveValue("")
  await expect(page.getByText(/未保存の変更があります/)).toHaveCount(0)
})

test("a pending save stays locked when navigation is requested and its failure preserves the draft", async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route("**/information", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    requested = true
    await held
    await route.abort("failed")
  })
  try {
    await page
      .getByLabel("本文", { exact: true })
      .fill("送信結果が不明でも残す入力")
    await page.getByLabel("種別", { exact: true }).selectOption("error")
    await page
      .getByLabel("有効期限（指定タイムゾーン）", { exact: true })
      .fill("2031-01-01T12:00")
    await page.getByRole("button", { name: "追加", exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "参加者", exact: true })
      .click()
    await expect(page.getByLabel("本文", { exact: true })).toBeDisabled()
    release()
    await expect(page).toHaveURL(/\/participant$/)
    await page.goBack()
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "操作結果を確認できませんでした",
    )
    await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
      "送信結果が不明でも残す入力",
    )
    await expect(page.getByLabel("本文", { exact: true })).toBeEnabled()
    await expect(page.getByLabel("種別", { exact: true })).toHaveValue("error")
  } finally {
    release()
  }
})

test("validation rejection preserves notice tone and retry clears the accepted draft", async ({
  page,
}, testInfo) => {
  const content = "入力エラー後も種別を保持する合成のお知らせ"
  const body = page.getByLabel("本文", { exact: true })
  const tone = page.getByLabel("種別", { exact: true })
  const timeZone = page.getByLabel("入力タイムゾーン", { exact: true })
  const expiry = page.getByLabel("有効期限（指定タイムゾーン）", {
    exact: true,
  })
  const records = database
    .collection("information")
    .where("content", "==", content)
  try {
    await body.fill(content)
    await tone.selectOption("warning")
    await timeZone.fill("Invalid/Zone")
    await expiry.fill("2030-01-01T12:00")
    await page.getByRole("button", { name: "追加", exact: true }).click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "タイムゾーン",
    )
    await expect(tone).toHaveValue("warning")
    await expect(body).toHaveValue(content)
    await expect(expiry).toHaveValue("2030-01-01T12:00")
    expect((await records.get()).empty).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath("notice-validation-draft.png"),
      fullPage: true,
    })
    await timeZone.fill("Asia/Tokyo")
    await page.getByRole("button", { name: "追加", exact: true }).click()
    await expect(
      page.locator("article").filter({ hasText: content }),
    ).toContainText("warning")
    const saved = await records.get()
    expect(saved.size).toBe(1)
    expect(saved.docs[0].data().tone).toBe("warning")
    expect(saved.docs[0].data().expireAt.toDate().toISOString()).toBe(
      "2030-01-01T03:00:00.000Z",
    )
    await expect(body).toHaveValue("")
    await expect(tone).toHaveValue("info")
    await expect(expiry).toHaveValue("")
    await expect(page.getByText(/未保存の変更があります/)).toHaveCount(0)
  } finally {
    for (const record of (await records.get()).docs) await record.ref.delete()
  }
})

import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

let database: Firestore
test.beforeAll(() => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-admin-information" })
})
test.afterAll(async () => {
  if (database) await database.terminate()
})

test("Admin creates, edits, fences stale edits and confirms deletion", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  await page.goto("/information?serverId=all")
  await expect(
    page.getByRole("heading", { name: "お知らせ管理", exact: true }).first(),
  ).toBeVisible()
  await page
    .getByLabel("本文", { exact: true })
    .fill("ブラウザー通知 <script>plain text</script>")
  await page.getByLabel("種別", { exact: true }).selectOption("warning")
  await page
    .getByLabel("有効期限（指定タイムゾーン）", { exact: true })
    .fill("2030-01-01T12:00")
  await page.getByRole("button", { name: "追加", exact: true }).click()
  const article = page.locator("article")
  await expect(article).toHaveCount(1)
  await expect(article).toContainText(
    "ブラウザー通知 <script>plain text</script>",
  )
  const original = (await database.collection("information").get()).docs[0]
  await article.getByRole("button", { name: "編集", exact: true }).click()
  await expect(
    page.getByLabel("有効期限（指定タイムゾーン）", { exact: true }),
  ).toHaveValue("2030-01-01T12:00")
  await page.getByLabel("本文", { exact: true }).fill("編集済み通知")
  await page.getByRole("button", { name: "変更を保存", exact: true }).click()
  await expect(article).toContainText("編集済み通知")
  const edited = await original.ref.get()
  expect(edited.data()?.createdAt.isEqual(original.data().createdAt)).toBe(true)
  expect(edited.data()?.expireAt.toDate().toISOString()).toBe(
    "2030-01-01T03:00:00.000Z",
  )
  await article.getByRole("button", { name: "編集", exact: true }).click()
  await page.getByLabel("本文", { exact: true }).fill("未保存の入力")
  await original.ref.update({ content: "別の研究責任者による編集" })
  await page.getByRole("button", { name: "変更を保存", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "別の操作で更新または削除",
  )
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    "未保存の入力",
  )
  await expect(page.getByLabel("種別", { exact: true })).toHaveValue("warning")
  expect((await original.ref.get()).data()?.content).toBe(
    "別の研究責任者による編集",
  )
  await page
    .getByRole("button", { name: "一覧を再読み込み", exact: true })
    .click()
  await expect(article).toContainText("別の研究責任者による編集")
  const review = page.getByRole("region", { name: "最新版の確認" })
  const resume = review.getByRole("button", {
    name: "最新版を確認し、入力中の内容で編集を続ける",
    exact: true,
  })
  const save = page.getByRole("button", { name: "変更を保存", exact: true })
  await expect(review).toContainText("別の研究責任者による編集")
  await expect(save).toBeDisabled()
  await expect(
    article.getByRole("button", { name: "編集", exact: true }),
  ).toBeDisabled()
  await resume.click()
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    "未保存の入力",
  )
  await original.ref.update({ content: "確認後にもう一度変更" })
  await save.click()
  await expect(review).toContainText("確認後にもう一度変更")
  await expect(save).toBeDisabled()
  expect((await original.ref.get()).data()?.content).toBe(
    "確認後にもう一度変更",
  )
  await resume.click()
  await save.click()
  await expect(article).toContainText("未保存の入力")
  expect((await original.ref.get()).data()?.content).toBe("未保存の入力")
  await article.getByRole("button", { name: "削除", exact: true }).click()
  await expect(
    page.getByText("このお知らせを削除します。元に戻せません。"),
  ).toBeVisible()
  expect((await original.ref.get()).exists).toBe(true)
  await article.getByRole("button", { name: "削除を確定", exact: true }).click()
  await expect(article).toHaveCount(0)
  expect((await original.ref.get()).exists).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole("button", { name: "追加", exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test("a deleted notice keeps the draft and cannot be recreated by a stale save", async ({
  page,
}) => {
  const reference = database
    .collection("information")
    .doc("deleted-while-editing")
  await reference.set({
    content: "削除前のお知らせ",
    tone: "info",
    createdAt: new Date(),
    expireAt: new Date("2030-01-01T00:00:00Z"),
  })
  await page.goto("/information")
  await page
    .locator("article")
    .filter({ hasText: "ID: deleted-while-editing" })
    .getByRole("button", { name: "編集", exact: true })
    .click()
  await page.getByLabel("本文", { exact: true }).fill("保持する下書き")
  await reference.delete()
  await page.getByRole("button", { name: "変更を保存", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "最新版の確認" }),
  ).toContainText("削除されています")
  await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
    "保持する下書き",
  )
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeDisabled()
  expect((await reference.get()).exists).toBe(false)
  page.once("dialog", (dialog) => dialog.accept())
  await page
    .getByRole("button", { name: "編集を取り消す", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "追加", exact: true }),
  ).toBeEnabled()
})

test("a list refresh cannot replace the version awaiting deletion confirmation", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  const reference = database
    .collection("information")
    .doc("changed-before-delete")
  await reference.set({
    content: "削除確認前のお知らせ",
    tone: "info",
    createdAt: new Date(),
    expireAt: new Date("2030-01-01T00:00:00Z"),
  })
  try {
    await page.goto("/information")
    const article = page
      .locator("article")
      .filter({ hasText: "ID: changed-before-delete" })
    await article.getByRole("button", { name: "削除", exact: true }).click()
    await reference.update({ content: "削除確認中に別の研究責任者が更新" })
    await page
      .getByRole("button", { name: "一覧を再読み込み", exact: true })
      .click()
    await expect(article).toContainText("削除確認中に別の研究責任者が更新")
    await article
      .getByRole("button", { name: "削除を確定", exact: true })
      .click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "別の操作で更新または削除",
    )
    expect((await reference.get()).data()?.content).toBe(
      "削除確認中に別の研究責任者が更新",
    )
    await expect(
      article.getByRole("button", { name: "削除を確定", exact: true }),
    ).toHaveCount(0)
    await article.getByRole("button", { name: "削除", exact: true }).click()
    await article
      .getByRole("button", { name: "削除を確定", exact: true })
      .click()
    await expect(article).toHaveCount(0)
    expect((await reference.get()).exists).toBe(false)
  } finally {
    await reference.delete()
  }
})

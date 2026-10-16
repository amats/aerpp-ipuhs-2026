import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

let database: Firestore
test.beforeAll(async () => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-admin-information" })
  const batch = database.batch()
  for (const purpose of ["research", "test", "unclassified"]) {
    const owner = {
      pseudonym: `purpose-${purpose}`,
      consentId: `purpose-${purpose}`,
      clientId: `purpose-${purpose}`,
      serverId: "purpose-server",
      ...(purpose === "unclassified" ? {} : { dataPurpose: purpose }),
    }
    batch.set(database.doc(`participationEvents/${owner.consentId}`), {
      ...owner,
      eventType: "consent",
      consentRequestedAt: Timestamp.fromDate(new Date("2026-09-20T01:02:03Z")),
      consentConfirmedAt: Timestamp.now(),
    })
    batch.set(database.doc(`analysisQuestionnaires/${owner.consentId}`), {
      ...owner,
      analysisId: owner.consentId,
      submittedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    })
  }
  await batch.commit()
})
test.afterAll(async () => {
  if (!database) return
  const batch = database.batch()
  for (const purpose of ["research", "test", "unclassified"]) {
    for (const collection of ["participationEvents", "analysisQuestionnaires"])
      batch.delete(database.doc(`${collection}/purpose-${purpose}`))
  }
  await batch.commit()
  await database.terminate()
})

test("operational purpose selection survives navigation while source downloads retain every purpose", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  await page.goto("/survey?serverId=purpose-server")
  const reception = page
    .locator("header p")
    .filter({ hasText: "Web受付終了日時：" })
    .locator("time")
  const backendStop = page
    .locator("header p")
    .filter({ hasText: "Support終了日時：" })
    .locator("time")
  await expect(reception).toHaveText("2000/01/02 00:00:00")
  await expect(reception).toHaveAttribute(
    "datetime",
    "2000-01-01T15:00:00.000Z",
  )
  await expect(backendStop).toHaveText("2099/12/31 09:00:00")
  await expect(backendStop).toHaveAttribute(
    "datetime",
    "2099-12-31T00:00:00.000Z",
  )
  await expect(page.locator("header")).toContainText("日本時間・UTC+09:00")
  const rows = page.locator("tbody tr")
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText("purpose-research")
  await expect(page.getByLabel("データ区分", { exact: true })).toHaveValue(
    "research",
  )
  await page.getByLabel("データ区分", { exact: true }).selectOption("test")
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText("purpose-test")
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "参加者", exact: true })
    .click()
  await expect(page).toHaveURL(/dataPurpose=test/)
  await expect(rows).toContainText("purpose-test")
  await page
    .getByLabel("データ区分", { exact: true })
    .selectOption("unclassified")
  await expect(rows).toContainText("purpose-unclassified")
  await page.getByLabel("データ区分", { exact: true }).selectOption("all")
  await expect(rows).toHaveCount(3)
  const response = await page.request.get(
    "/api/research/export?format=json&dataPurpose=all",
  )
  expect(response.ok()).toBe(true)
  const exported = await response.json()
  expect(exported.manifest.excludedRecords).toBe(0)
  expect(
    exported.analysisQuestionnaires.map((row: { id: string }) => row.id),
  ).toEqual(["purpose-research", "purpose-test", "purpose-unclassified"])
  expect(exported).not.toHaveProperty("participationEvents")
  const csv = await page.request.get(
    "/api/research/export?format=analysisQuestionnaires&dataPurpose=test",
  )
  expect(csv.ok()).toBe(true)
  const body = await csv.text()
  expect(body).toContain("purpose-research")
  expect(body).toContain("purpose-test")
  expect(body).toContain("purpose-unclassified")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel("データ区分", { exact: true })).toBeVisible()
})

test("research participant status includes withdrawal recorded under another purpose", async ({
  page,
}) => {
  const ref = database.doc("participationEvents/purpose-research-withdrawal")
  try {
    await ref.set({
      pseudonym: "purpose-research",
      consentId: "purpose-research",
      eventType: "withdrawal",
      dataPurpose: "test",
      serverId: "another-server",
      withdrawalAcceptedAt: Timestamp.now(),
    })
    await page.goto("/dashboard")
    await expect(
      page.getByText("ローカル検証環境では Cloud Logging を利用しません。"),
    ).toBeVisible()
    const state = page.getByText("withdrawal", { exact: true }).locator("..")
    await expect(state).toContainText("1")
    await page.goto("/participant")
    await expect(
      page.getByRole("heading", { name: "同意・撤回の履歴", exact: true }),
    ).toBeVisible()
    await expect(page.locator("tbody tr")).toHaveCount(1)
    await expect(
      page.getByRole("columnheader", { name: "同意申請日時", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", {
        name: "同意確認・撤回受付日時",
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator("tbody tr")).toContainText("2026/09/20 10:02")
    await expect(page.locator("tbody tr")).toContainText("purpose-research")
    await expect(page.locator("tbody tr")).not.toContainText("withdrawal")
  } finally {
    await ref.delete()
  }
})

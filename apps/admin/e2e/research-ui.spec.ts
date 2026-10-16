import { readFile } from "node:fs/promises"
import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"
import { sealData } from "iron-session"
import { readArchive } from "../test-support/read-archive"
import {
  addAnalysis,
  addPerson,
  fixtureSource,
} from "../test-support/research-fixtures"

let database: Firestore
const paths: string[] = []
test.beforeAll(async () => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-admin-information" })
  const source = fixtureSource()
  addPerson(source, "ui-review")
  const completion = addAnalysis(source, "ui-review", "ui-review-analysis")
  delete completion.data.submittedAt
  const encryptedEmail = await sealData("participant@example.invalid", {
    password: "synthetic-information-email-seal-password",
    ttl: -3600,
  })
  source.participationEvents[0].data.encryptedEmail = encryptedEmail
  addPerson(source, "ui-unreadable")
  source.participationEvents[1].data.encryptedEmail =
    "synthetic-mail-acceptance-no-personal-data"
  source.participationStates[0].data.status = "withdrawn"
  source.participationEvents.push({
    id: "withdrawal-ui-review",
    data: {
      pseudonym: "ui-review",
      consentId: "consent-ui-review",
      eventType: "withdrawal",
      consentBoundaryId: null,
      withdrawalAcceptedAt: "2026-01-03T00:00:00Z",
    },
  })
  addPerson(source, "ui-valid")
  const valid = addAnalysis(source, "ui-valid", "ui-valid-analysis", {
    processingDurationSeconds: 12,
  })
  delete valid.data.submittedAt
  source.analysisQuestionnaires[0].data.dataPurpose = "test"
  source.analysisQuestionnaires[0].data.serverId = "another-server"
  const batch = database.batch()
  paths.push("emailConfirmations/ui-review-auth")
  batch.set(database.doc("emailConfirmations/ui-review-auth"), {
    pseudonym: "ui-review",
    consentId: "consent-ui-review",
    status: "completed",
    encryptedEmail,
    createdAt: Timestamp.fromMillis(1700000000000),
    updatedAt: Timestamp.fromMillis(1700000001000),
    tokenHash: "NEVER-EXPORT-VERIFIER",
  })
  paths.push("emailConfirmations/ui-unreadable-auth")
  batch.set(database.doc("emailConfirmations/ui-unreadable-auth"), {
    pseudonym: "ui-unreadable",
    encryptedEmail: "synthetic-mail-acceptance-no-personal-data",
    status: "completed",
  })
  const collections = {
    participationEvents: "participationEvents",
    analysisQuestionnaires: "analysisQuestionnaires",
    attempts: "analysisAttempts",
    analysisRuns: "analysisRuns",
    participationStates: "participationStates",
  } as const
  for (const key of Object.keys(collections) as Array<
    keyof typeof collections
  >) {
    for (const record of source[key] ?? []) {
      const path = `${collections[key]}/${record.id}`
      paths.push(path)
      batch.set(database.doc(path), {
        ...record.data,
        ...(record.data.serverId && key !== "analysisQuestionnaires"
          ? { serverId: "purpose-server" }
          : {}),
      })
    }
  }
  for (let index = 0; index < 12; index++) {
    const path = `information/ui-review-${index}`
    paths.push(path)
    batch.set(database.doc(path), {
      content: `合成のお知らせ${index}\n${"表示確認用です。\n".repeat(8)}`,
      tone: "info",
      createdAt: Timestamp.fromMillis(1700000000000 + index * 1000),
      expireAt: Timestamp.fromMillis(2000000000000),
    })
  }
  await batch.commit()
})
test.afterAll(async () => {
  if (!database) return
  const batch = database.batch()
  for (const path of paths) batch.delete(database.doc(path))
  await batch.commit()
  await database.terminate()
})
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
})

test("downloads complete exports with decrypted and unreadable emails after reception ends", async ({
  page,
}) => {
  await page.goto("/research")
  await expect(page.getByText(/email欄に「復号できません」/)).toBeVisible()
  await expect(page.getByRole("button", { name: "仮解析を実行" })).toHaveCount(
    0,
  )
  await expect(page.getByRole("link", { name: /まとめて保存/ })).toHaveCount(0)
  const downloads: Record<string, Record<string, string>> = {}
  for (const [dataset, name] of [
    ["research", "研究用データを保存（ZIP）"],
    ["access", "参加管理・アクセスデータを保存（ZIP）"],
  ]) {
    const downloading = page.waitForEvent("download")
    await page.getByRole("button", { name, exact: true }).click()
    const download = await downloading
    expect(await download.failure()).toBeNull()
    const path = await download.path()
    if (!path) throw new Error("Download path missing")
    downloads[dataset] = readArchive(await readFile(path))
    expect(
      Object.keys(downloads[dataset]).every((file) => !file.includes("/")),
    ).toBe(true)
  }
  const research = JSON.parse(downloads.research["source.json"])
  // Unsubmitted completion metadata does not require questionnaire archives.
  expect(research.manifest.schemaVersion).toBe(6)
  expect(research.questionnaires).toEqual({})
  expect(research.manifest.archivedQuestionnaireIds).toEqual([])
  expect(
    Object.keys(downloads.research).filter((name) =>
      name.startsWith("questionnaires/"),
    ),
  ).toEqual([])
  const access = JSON.parse(downloads.access["source.json"])
  const consent = access.participationEvents.find(
    (row: { id: string }) => row.id === "consent-ui-review",
  )
  expect(access.manifest.schemaVersion).toBe(8)
  expect(
    access.participationEvents.find(
      (row: { id: string }) => row.id === "consent-ui-unreadable",
    ).data,
  ).toMatchObject({ email: "復号できません", did: null })
  expect(
    access.emailConfirmations.find(
      (row: { id: string }) => row.id === "ui-unreadable-auth",
    ).data.email,
  ).toBe("復号できません")
  expect(downloads.access["participation-events.csv"]).toContain(
    "復号できません",
  )
  expect(downloads.access["email-confirmations.csv"]).toContain(
    "復号できません",
  )
  expect(downloads.access["source.json"]).not.toContain(
    "synthetic-mail-acceptance-no-personal-data",
  )
  expect(access.manifest.counts.participationEvents).toEqual({
    read: access.participationEvents.length,
    exported: access.participationEvents.length,
  })
  expect(access.manifest.counts.emailConfirmations).toEqual({
    read: access.emailConfirmations.length,
    exported: access.emailConfirmations.length,
  })
  expect(consent.data.did).toMatch(/^aerpp:did-[A-Za-z0-9]{32}$/)
  expect(downloads.access["participation-events.csv"]).toContain(
    consent.data.did,
  )
  expect(downloads.research["source.json"]).not.toContain(consent.data.did)
  expect(
    research.analysisQuestionnaires.some(
      (row: { id: string }) => row.id === "ui-review-analysis",
    ),
  ).toBe(false)
  expect(
    research.analysisQuestionnaires.find(
      (row: { id: string }) => row.id === "ui-valid-analysis",
    )?.data.processingDurationSeconds,
  ).toBe(12)
  expect(
    research.attempts.find(
      (row: { id: string }) => row.id === "ui-valid-analysis",
    )?.data.durationMs,
  ).toBe(5000)
  expect(research.manifest.excludedRecords).toBe(2)
  expect(
    access.analysisAccess.some(
      (row: { id: string }) => row.id === "ui-review-analysis",
    ),
  ).toBe(true)
  expect(downloads.access["participation-events.csv"]).toContain(
    "participant@example.invalid",
  )
  expect(downloads.access["email-confirmations.csv"]).toContain(
    "participant@example.invalid",
  )
  expect(JSON.stringify(downloads.research)).not.toContain(
    "participant@example.invalid",
  )
  expect(JSON.stringify(downloads.access)).not.toContain("encryptedEmail")
  expect(downloads.access["source.json"]).not.toContain("NEVER-EXPORT-VERIFIER")
  expect(
    access.participationEvents.find(
      (row: { id: string }) => row.id === "consent-ui-review",
    ).data.email,
  ).toBe("participant@example.invalid")
  expect(
    access.emailConfirmations.find(
      (row: { id: string }) => row.id === "ui-review-auth",
    ).data.updatedAt,
  ).toEqual({ seconds: 1700000001, nanoseconds: 0 })
  expect(
    access.participationStates.find(
      (row: { id: string }) => row.id === "state-ui-review",
    ).data.status,
  ).toBe("withdrawn")
  expect(research.manifest.counts.analysisQuestionnaires.read).toBe(
    research.analysisQuestionnaires.length + 1,
  )
  expect(access.manifest.exportId).not.toBe(research.manifest.exportId)
  await page.setViewportSize({ width: 320, height: 900 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test("editing a notice moves keyboard focus and the viewport to its form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/information")
  const article = page.locator("article").filter({ hasText: "ID: ui-review-0" })
  await article.getByRole("button", { name: "編集", exact: true }).click()
  const content = page.getByLabel("本文", { exact: true })
  await expect(content).toBeFocused()
  await expect(content).toBeInViewport({ ratio: 1 })
  await expect(content).toHaveValue(/^合成のお知らせ0/)
})

test("notice validation brings errors into view without losing the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/information")
  await page.getByLabel("本文", { exact: true }).fill("保存前の本文")
  await page
    .getByLabel("有効期限（指定タイムゾーン）", { exact: true })
    .fill("2030-01-01T12:00")
  await page
    .getByLabel("入力タイムゾーン", { exact: true })
    .fill("Invalid/Zone")
  const error = page.getByRole("main").getByRole("alert")
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "追加", exact: true }).click()
    await expect(error).toContainText("タイムゾーン")
    await expect(error).toBeFocused()
    await expect(error).toBeInViewport({ ratio: 1 })
    await expect(page.getByLabel("本文", { exact: true })).toHaveValue(
      "保存前の本文",
    )
  }
})

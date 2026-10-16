import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

test("shows stored answer counts without version gates, score ranges or averages", async ({
  page,
}) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const database = new Firestore({ projectId: "demo-admin-information" })
  const ids = ["count-initial-1", "count-initial-2", "count-followup"]
  try {
    const batch = database.batch()
    for (const [index, id] of ids.entries()) {
      const owner = {
        analysisId: id,
        serverId: "purpose-server",
        clientId: id,
        pseudonym: id,
        consentId: id,
        dataPurpose: "research",
      }
      batch.set(database.doc(`analysisAttempts/${id}`), {
        ...owner,
        questionnaireKind: index === 2 ? "follow-up" : "initial",
        outcome: "completed",
        startedAtMs: 1700000000000,
      })
      batch.set(database.doc(`analysisQuestionnaires/${id}`), {
        ...owner,
        analysisWorkspaceVersion: index === 2 ? "1.0.1" : "1.0.0",
        questionnaire: {
          kind: index === 2 ? "follow-up" : "initial",
          definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
        },
        submittedAt: Timestamp.fromMillis(1700000001000),
        createdAt: Timestamp.fromMillis(1700000000000),
        answers:
          index === 2
            ? { PE_F1: "保存された回答文言" }
            : {
                PE1: index === 0 ? "0" : "8",
                BG1: "保存された選択肢",
                TX1: "合成自由記述",
              },
      })
    }
    await batch.commit()
    await page.goto("/survey")
    const versionHeader = page.getByRole("columnheader", {
      name: "解析時のバージョン",
      exact: true,
    })
    await expect(versionHeader).toBeVisible()
    const records = page.getByRole("table").filter({ has: versionHeader })
    for (const [index, id] of ids.entries())
      await expect(
        records.getByRole("row").filter({ hasText: id }),
      ).toContainText(index === 2 ? "1.0.1" : "1.0.0")
    await expect(page.getByText(/平均/)).toHaveCount(0)
    for (const [title, itemId, count] of [
      ["初回用アンケートの項目別回答数", "PE1", 2],
      ["初回用アンケートの項目別回答数", "BG1", 2],
      ["初回用アンケートの項目別回答数", "TX1", 2],
      ["フォローアップの項目別回答数", "PE_F1", 1],
    ] as const) {
      const group = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        })
        .last()
      const item = group
        .getByText(itemId, { exact: true })
        .locator("..")
        .locator("..")
      await expect(item).toContainText(`回答数: ${count}`)
    }
    await page.goto("/dashboard")
    await expect(page.getByText(/平均/)).toHaveCount(0)
  } finally {
    const batch = database.batch()
    for (const id of ids) {
      batch.delete(database.doc(`analysisQuestionnaires/${id}`))
      batch.delete(database.doc(`analysisAttempts/${id}`))
    }
    await batch.commit()
    await database.terminate()
  }
})

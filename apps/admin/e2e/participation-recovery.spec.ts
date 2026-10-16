import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { deriveParticipantDocumentId } from "@aerpp/participant-api-contracts/identifiers"
import { Firestore } from "@google-cloud/firestore"
import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

async function lookupPid(page: Page, pseudonym: string) {
  await page.getByLabel("参加者PID", { exact: true }).fill(pseudonym)
  await page
    .getByRole("button", { name: "PIDの記録を照会する", exact: true })
    .click()
  await expect(page.getByRole("form", { name: "復旧方針の選択" })).toBeVisible()
}

test("derive PID from email, review scoped records and invalidate a changed target", async ({
  page,
}, testInfo) => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const db = new Firestore({ projectId: "demo-admin-information" })
  const repository = createParticipantRepository(db)
  const pseudonym = "aerpp:pid-dfc78b948e6d29c737a9bc66cb8fcdf9"
  const stateRef = repository.participationState(pseudonym)
  const owner = {
    pseudonym,
    serverId: "purpose-server",
    clientId: "original-browser",
    consentId: "lookup-consent",
  }
  const records = [
    repository.participationEvent("lookup-consent"),
    repository.participationEvent("lookup-test-withdrawal"),
    repository.participationEvent("lookup-other-server"),
    repository.analysisAttempt("lookup-running"),
    repository.analysisAttempt("lookup-completed"),
    repository.analysisQuestionnaire("lookup-completed"),
    repository.analysisRun("lookup-running"),
    repository.analysisRun("lookup-completed"),
  ]
  await stateRef.set({ pseudonym, status: "active", studyStatus: "follow-up" })
  await records[0].set({
    ...owner,
    eventType: "consent",
    dataPurpose: "research",
    consentRequestedAt: new Date(1000),
    consentConfirmedAt: new Date(2000),
    encryptedEmail: "synthetic-contact-must-not-display",
  })
  await records[1].set({
    ...owner,
    eventType: "withdrawal",
    dataPurpose: "test",
    withdrawalAcceptedAt: new Date(3000),
  })
  await records[2].set({
    ...owner,
    serverId: "other-server",
    eventType: "consent",
    consentConfirmedAt: new Date(4000),
  })
  await records[3].set({
    ...owner,
    startedAtMs: 5000,
    questionnaireKind: "follow-up",
  })
  await records[4].set({
    ...owner,
    outcome: "completed",
    startedAtMs: 6000,
    endedAtMs: 7000,
    questionnaireKind: "initial",
  })
  await records[5].set({
    ...owner,
    createdAt: new Date(7000),
    presentationRecordedAt: new Date(8000),
    submittedAt: new Date(9000),
    answers: { q1: "synthetic-answer-must-not-display" },
  })
  await records[6].set((await records[3].get()).data() ?? {})
  await records[7].set({
    ...(await records[4].get()).data(),
    createdAt: new Date(7000),
    presentationRecordedAt: new Date(8000),
    submittedAt: new Date(9000),
  })
  try {
    await page.goto("/participant?dataPurpose=research")
    const decision = page.getByRole("form", { name: "復旧方針の選択" })
    await expect(decision).toHaveCount(0)
    await page.getByLabel("照会方法").selectOption("email")
    await page
      .getByLabel("参加者メールアドレス")
      .fill(" PERSON@EXAMPLE.INVALID ")
    await page
      .getByRole("button", { name: "PIDの記録を照会する", exact: true })
      .click()
    await expect(decision).toBeVisible()
    await expect(
      decision.getByText(`対象PID: ${pseudonym}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("照会方法")).toHaveValue("email")
    await expect(page.getByLabel("参加者メールアドレス")).toHaveValue(
      " PERSON@EXAMPLE.INVALID ",
    )
    // A second submission must still derive the PID from the same email.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/participant" &&
          response.request().method() === "POST",
      ),
      page
        .getByRole("button", { name: "PIDの記録を照会する", exact: true })
        .click(),
    ])
    await expect(decision).toBeVisible()
    await expect(
      decision.getByText(`対象PID: ${pseudonym}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel("照会方法")).toHaveValue("email")
    await page
      .getByLabel("照会方法")
      .locator("..")
      .locator("..")
      .screenshot({
        path: testInfo.outputPath("email-lookup-repeated.png"),
      })
    const events = page.getByRole("region", {
      name: "同意・撤回・復旧許可の履歴",
      exact: true,
    })
    await expect(events.getByRole("listitem")).toHaveCount(2)
    await expect(events.getByText("テスト", { exact: true })).toBeVisible()
    await expect(events).not.toContainText("lookup-other-server")
    await expect(
      page.getByRole("region", { name: "解析試行の履歴", exact: true }),
    ).toContainText("終了未確認")
    await expect(
      page.getByRole("region", {
        name: "解析完了・アンケート提出の記録",
        exact: true,
      }),
    ).toContainText("回答提出日時")
    await expect(page.locator("body")).not.toContainText(
      "synthetic-contact-must-not-display",
    )
    await expect(page.locator("body")).not.toContainText(
      "synthetic-answer-must-not-display",
    )
    expect((await stateRef.get()).data()).toEqual({
      pseudonym,
      status: "active",
      studyStatus: "follow-up",
    })
    expect(
      (await repository.participationEventsFor(pseudonym).get()).size,
    ).toBe(3)
    await page
      .getByLabel("参加者メールアドレス")
      .fill("missing@example.invalid")
    await expect(decision).toHaveCount(0)
    await page
      .getByRole("button", { name: "PIDの記録を照会する", exact: true })
      .click()
    await expect(
      page.getByText(
        "参加状態の記録はありません。PIDと対象環境を確認してください。",
        { exact: true },
      ),
    ).toBeVisible()
    await expect(decision).toHaveCount(0)
    await page.getByLabel("照会方法").selectOption("pid")
    await lookupPid(page, pseudonym)
    await expect(
      decision.getByText(`対象PID: ${pseudonym}`, { exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 375, height: 812 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    for (const record of records) await record.delete()
    await stateRef.delete()
    await db.terminate()
  }
})

for (const destination of [
  "initial-document",
  "initial-survey",
  "follow-up-document",
]) {
  test(`review and confirm ${destination} without erasing history`, async ({
    page,
  }) => {
    if (
      !/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
    )
      throw new Error("Isolated emulator required")
    const db = new Firestore({ projectId: "demo-admin-information" })
    const repository = createParticipantRepository(db)
    const pseudonym = `synthetic-recovery-${destination}`
    const owner = {
      pseudonym,
      serverId: "purpose-server",
      clientId: "original-browser",
      consentId: `consent-${destination}`,
    }
    const analysisId = `analysis-${destination}`
    const ref = repository.participationState(pseudonym)
    await ref.set({
      pseudonym,
      status: "active",
      dataPurpose: "research",
      studyStatus: "initial-pending",
      initialAnalysis: { ...owner, analysisId },
    })
    const history = repository.participationEvent(owner.consentId)
    await history.set({
      ...owner,
      dataPurpose: "research",
      eventType: "consent",
      consentConfirmedAt: new Date(),
    })
    await repository.analysisAttempt(analysisId).set({
      ...owner,
      analysisId,
      outcome: "completed",
      questionnaireKind: "initial",
    })
    await repository.analysisQuestionnaire(analysisId).set({
      ...owner,
      analysisId,
      createdAt: new Date(),
      _integrity: { version: 1, metadata: { ...owner, analysisId } },
    })
    try {
      await page.goto("/participant")
      await lookupPid(page, pseudonym)
      const decision = page.getByRole("form", { name: "復旧方針の選択" })
      await page
        .getByRole("combobox", { name: "復旧先", exact: true })
        .selectOption(destination)
      await page
        .getByLabel("許可理由", { exact: false })
        .fill("Synthetic researcher review")
      await page
        .getByRole("button", { name: "対象を確認する", exact: true })
        .click()
      await expect(decision.getByRole("status")).toContainText(
        "対象と復旧先を確認",
      )
      expect((await ref.get()).data()?.recoveryAuthorization).toBeUndefined()
      await expect(
        page.getByText("現在の参加区分: 初回", { exact: true }),
      ).toBeVisible()
      if (destination === "initial-survey")
        await expect(
          page.getByText(`参加状態: active ／ 対象解析: ${analysisId}`),
        ).toBeVisible()
      await page
        .getByRole("button", { name: "確認して復旧を許可する", exact: true })
        .click()
      await expect(decision.getByRole("status")).toContainText(
        "復旧を許可しました",
      )
      const state = (await ref.get()).data()
      expect(state?.initialAnalysis.analysisId).toBe(analysisId)
      expect((await history.get()).exists).toBe(true)
      const authorization = state?.recoveryAuthorization
      expect(authorization).toMatchObject({
        destination,
        reason: "Synthetic researcher review",
        expectedStudyGeneration: null,
      })
      expect(authorization.actorId).toMatch(/^[a-f0-9]{64}$/)
      if (destination === "initial-survey")
        expect(authorization).toMatchObject({ analysisId, sourceOwner: owner })
      const event = (
        await repository.participationEvent(authorization.recoveryId).get()
      ).data()
      expect(event).toMatchObject({
        eventType: "recovery_authorized",
        pseudonym,
        destination,
      })
      expect(JSON.stringify(event)).not.toContain("@")
      await page.reload()
      await expect(
        page.getByText("Synthetic researcher review", { exact: true }),
      ).toBeVisible()
      await lookupPid(page, pseudonym)
      await page
        .getByRole("combobox", { name: "復旧先", exact: true })
        .selectOption("initial-document")
      await page
        .getByLabel("許可理由", { exact: false })
        .fill("Synthetic replacement review")
      await page
        .getByRole("button", { name: "対象を確認する", exact: true })
        .click()
      await expect(
        page.getByRole("button", {
          name: "確認して復旧を許可する",
          exact: true,
        }),
      ).toBeVisible()
      // Reject a stale confirmation after any intervening state update.
      await ref.update({ updatedAt: new Date() })
      await page
        .getByRole("button", { name: "確認して復旧を許可する", exact: true })
        .click()
      await expect(decision.getByRole("status")).toContainText(
        "記録が更新されました",
      )
      expect((await ref.get()).data()?.recoveryAuthorization.recoveryId).toBe(
        authorization.recoveryId,
      )
      await lookupPid(page, pseudonym)
      await page
        .getByRole("combobox", { name: "復旧先", exact: true })
        .selectOption("initial-document")
      await page
        .getByLabel("許可理由", { exact: false })
        .fill("Synthetic replacement review")
      await page
        .getByRole("button", { name: "対象を確認する", exact: true })
        .click()
      await page
        .getByRole("button", { name: "確認して復旧を許可する", exact: true })
        .click()
      await expect(decision.getByRole("status")).toContainText(
        "復旧を許可しました",
      )
      const replacement = (await ref.get()).data()?.recoveryAuthorization
      expect(replacement.recoveryId).not.toBe(authorization.recoveryId)
      expect(replacement).not.toHaveProperty("usedConsentId")
      expect(
        (
          await repository.participationEvent(authorization.recoveryId).get()
        ).data()?.supersededBy,
      ).toBe(replacement.recoveryId)
    } finally {
      const audits = await repository.participationEventsFor(pseudonym).get()
      for (const doc of audits.docs) await doc.ref.delete()
      await repository.analysisAttempt(analysisId).delete()
      await repository.analysisQuestionnaire(analysisId).delete()
      await ref.delete()
      await db.terminate()
    }
  })
}

for (const purpose of ["consent", "withdrawal"] as const) {
  test(`verify a ${purpose} PDF repeatedly and clear the old match when an input changes`, async ({
    page,
  }, testInfo) => {
    await page.goto("/participant")
    const form = page.getByRole("form", { name: "PDFのDID照合" })
    await form
      .getByLabel("メールアドレス", { exact: true })
      .fill("person@example.invalid")
    await form
      .getByLabel("PDFの日付（日本時間）", { exact: true })
      .fill("2026-03-20")
    const documentType = form.getByRole("combobox", {
      name: "文書種別",
      exact: true,
    })
    await documentType.selectOption(purpose)
    await form
      .getByLabel("DID", { exact: true })
      .fill(
        deriveParticipantDocumentId(
          "person@example.invalid",
          "2026年3月20日",
          purpose,
          "synthetic-information-identifier-secret",
          "a".repeat(64),
        ),
      )
    await form.getByLabel("文書セットのバージョン", { exact: true }).fill("1.0")
    await form
      .getByLabel("文書セットSHA-256", { exact: true })
      .fill("a".repeat(64))
    await form
      .getByRole("button", { name: "DIDを照合する", exact: true })
      .click()
    await expect(form.getByRole("status")).toContainText("DIDが一致しました。")
    await expect(form).toContainText("保存原本と受付記録も別々に確認します")
    await expect(
      form.getByLabel("メールアドレス", { exact: true }),
    ).toHaveValue("person@example.invalid")
    await expect(documentType).toHaveValue(purpose)
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/participant" &&
          response.request().method() === "POST",
      ),
      form.getByRole("button", { name: "DIDを照合する", exact: true }).click(),
    ])
    await expect(
      form.getByRole("button", { name: "DIDを照合する", exact: true }),
    ).toBeEnabled()
    await expect(form.getByRole("status")).toContainText("DIDが一致しました。")
    await expect(documentType).toHaveValue(purpose)
    await form.screenshot({
      path: testInfo.outputPath(`did-${purpose}-repeated.png`),
    })
    const changedPurpose = purpose === "consent" ? "withdrawal" : "consent"
    await documentType.selectOption(changedPurpose)
    await expect(form.getByRole("status")).toHaveCount(0)
    await form
      .getByRole("button", { name: "DIDを照合する", exact: true })
      .click()
    await expect(form.getByRole("status")).toContainText("DIDが一致しません。")
    await expect(documentType).toHaveValue(changedPurpose)
  })
}

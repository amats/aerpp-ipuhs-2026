import type { Page } from "@playwright/test"
import { readStoredResult } from "../test-support/e2e/browser-state"
import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  documentInput,
  expect,
  fillSurvey,
  openDocuments,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

async function openWithdrawal(page: Page) {
  await page.goto("/withdraw")
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
}

async function openSurvey(page: Page) {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信" }),
  ).toBeVisible()
  await fillSurvey(page)
}

async function setStorageFailure(
  page: Page,
  method: "getItem" | "setItem" | "removeItem",
  enabled: boolean,
) {
  await page.evaluate(
    ({ method, enabled }) => {
      const marker = `e2e-original-${method}`
      const property = method === "getItem" ? "get" : "put"
      const original =
        Reflect.get(IDBObjectStore.prototype, marker) ??
        IDBObjectStore.prototype[property]
      Reflect.set(IDBObjectStore.prototype, marker, original)
      Reflect.set(
        IDBObjectStore.prototype,
        property,
        enabled
          ? function (
              this: IDBObjectStore,
              value: unknown,
              ...args: unknown[]
            ) {
              const deleting =
                value !== null &&
                typeof value === "object" &&
                "analysisResult" in value &&
                (value.analysisResult as { value: unknown }).value === null
              if (
                method === "getItem" ||
                (method === "removeItem" ? deleting : !deleting)
              )
                throw new DOMException(
                  "Synthetic browser storage failure",
                  "QuotaExceededError",
                )
              return Reflect.apply(original, this, [value, ...args])
            }
          : original,
      )
    },
    { method, enabled },
  )
}

async function waitForSessionIdle(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.locks.query()).held?.length ?? 0,
      ),
    )
    .toBe(0)
  // Flush the React commit after the action releases its browser lock.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  )
}

test("withdrawal waits for a cold-start response beyond ten seconds without resubmission", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await openWithdrawal(page)
  await localServices.scenario({ withdrawalDelayMs: 12_000 })
  const receipt = page.waitForEvent("download", { timeout: 30_000 })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("撤回申請を送信し、結果を確認しています", { exact: true }),
  ).toBeVisible()
  expect((await receipt).suggestedFilename()).toBe("AERPP-Withdrawal.pdf")
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).withdrawalHashes).toHaveLength(1)
})

test("accepted withdrawal keeps pending cleanup distinct across screens and issues the receipt before deletion", async ({
  page,
  localServices,
}, testInfo) => {
  await analyzeDocument(page)
  await openWithdrawal(page)
  await localServices.scenario({
    holdWithdrawal: true,
    withdrawalFailure: "pending",
  })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("撤回申請を送信し、結果を確認しています", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveAttribute("readonly", "")
  await expect(
    page.getByRole("button", { name: "送信しています...", exact: true }),
  ).toBeDisabled()
  await localServices.scenario({ withdrawalFailure: "pending" })
  const receipt = page.waitForEvent("download")
  await localServices.release()
  expect((await receipt).suggestedFilename()).toBe("AERPP-Withdrawal.pdf")
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", {
      name: "研究参加の撤回を受け付けました",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("ブラウザーを閉じて構いません。", { exact: false }),
  ).toHaveCount(0)
  await expect(
    page.getByText("画面を閉じても、受理済みの撤回は取り消されず", {
      exact: false,
    }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("withdrawal-pending-desktop.png"),
    fullPage: true,
  })
  await page.reload()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("link", { name: "同意履歴・関連書類", exact: true })
    .click()
  const pdf = page.getByRole("button", {
    name: "同意撤回書の控え：PDFをダウンロード",
    exact: true,
  })
  await expect(pdf).toBeEnabled()
  const pendingReceipt = page.waitForEvent("download")
  await pdf.click()
  expect((await pendingReceipt).suggestedFilename()).toBe(
    "AERPP-withdrawal-synthetic-withdrawal.pdf",
  )
  await page
    .getByRole("link", { name: "撤回・消去の状況を確認する", exact: true })
    .click()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText("メールアドレスを入力し、【同意を撤回する】", {
      exact: false,
    }),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator("footer")).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page.locator("footer").scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
  await page.screenshot({
    path: testInfo.outputPath("withdrawal-pending-mobile.png"),
    fullPage: true,
    animations: "disabled",
  })
  await localServices.scenario({})
  await page
    .getByRole("button", { name: "データ削除の再試行", exact: true })
    .click()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "データ削除の再試行", exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole("link", { name: "同意履歴・関連書類", exact: true })
    .click()
  const downloading = page.waitForEvent("download")
  await pdf.click()
  expect((await downloading).suggestedFilename()).toBe(
    "AERPP-withdrawal-synthetic-withdrawal.pdf",
  )
})

test("pending withdrawal automatically retries cleanup and stays terminal", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await openWithdrawal(page)
  await localServices.scenario({ withdrawalFailure: "pending" })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toHaveCount(0)
  const before = (await localServices.state()).withdrawalHashes.length
  await localServices.scenario({})
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible({ timeout: 45_000 })
  await expect(
    page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
  ).toBeVisible()
  const hashes = (await localServices.state()).withdrawalHashes
  expect(hashes.length).toBeGreaterThan(before)
  expect(new Set(hashes).size).toBe(1)
})

test("accepted withdrawal distinguishes a browser deletion failure from server cleanup", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await openWithdrawal(page)
  await setStorageFailure(page, "removeItem", true)
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("ブラウザー内の一時データを消去できませんでした", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("サーバーの対象データの消去は完了しました。", {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "データ削除の再試行", exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("button", { name: "ページを再読み込み", exact: true })
      .first(),
  ).toBeVisible()
  const withdrawals = (await localServices.state()).withdrawalHashes.length
  await setStorageFailure(page, "removeItem", false)
  await page
    .getByRole("button", { name: "データ削除の再試行", exact: true })
    .click()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).withdrawalHashes.length).toBe(
    withdrawals,
  )
})

test("a pending withdrawal receipt cannot delay explicit cleanup retry", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await openWithdrawal(page)
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route("**/api/documents?name=withdrawal", async (route) => {
    requested = true
    await hold
    await route.continue()
  })
  try {
    await localServices.scenario({ withdrawalFailure: "pending" })
    await page
      .getByRole("button", { name: "同意を撤回する", exact: true })
      .click()
    await expect.poll(() => requested).toBe(true)
    await expect(
      page.getByText("同意撤回書を準備しています", { exact: true }),
    ).toBeVisible()
    await localServices.scenario({})
    await page
      .getByRole("button", { name: "データ削除の再試行", exact: true })
      .click()
    await expect(
      page.getByText("データの消去が完了しました", { exact: true }),
    ).toBeVisible()
    // The PDF is still held; cleanup used the fixed accepted request independently.
    await expect(
      page.getByText("同意撤回書を準備しています", { exact: true }),
    ).toBeVisible()
    const hashes = (await localServices.state()).withdrawalHashes
    expect(hashes.length).toBeGreaterThan(1)
    expect(new Set(hashes).size).toBe(1)
  } finally {
    release()
  }
})

test("a pending consent receipt cannot delay analysis or replace its status after failure", async ({
  page,
  localServices,
}) => {
  await sendConsent(page)
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route("**/api/documents?name=consent", async (route) => {
    requested = true
    await hold
    await route.abort("failed")
  })
  try {
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    expect((await localServices.state()).analysisPromptHashes).toHaveLength(1)
    const failed = page.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/documents?name=consent"),
    )
    release()
    await failed
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText("同意書のダウンロードに失敗しました。", { exact: false }),
    ).toHaveCount(0)
  } finally {
    release()
  }
})

for (const reload of [false, true]) {
  test(`withdrawal PDF failure stays recoverable after withdrawal (reload: ${reload})`, async ({
    page,
    localServices,
  }, testInfo) => {
    await openDocuments(page)
    await openWithdrawal(page)
    let interrupted = false
    await page.route("**/api/documents?name=withdrawal", async (route) => {
      if (interrupted) return route.continue()
      interrupted = true
      await route.abort("failed")
    })
    await page
      .getByRole("button", { name: "同意を撤回する", exact: true })
      .click()
    await expect(
      page.getByText("同意撤回書のダウンロードに失敗しました。", {
        exact: false,
      }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/withdraw$/)
    await expect(
      page.getByRole("button", { name: "同意を撤回する", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText("撤回申請は受理されています。", {
        exact: false,
      }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("withdrawal-pdf-failure.png"),
      fullPage: true,
    })
    const before = (await localServices.state()).withdrawalHashes.length
    const downloading = page.waitForEvent("download")
    if (reload) {
      await page.reload()
      await expect(
        page.getByText("データの消去が完了しました", { exact: true }),
      ).toBeVisible()
      await expect(page).toHaveURL(/\/withdraw$/)
      await page
        .getByRole("link", {
          name: "同意履歴・関連書類（同意撤回書の控え）",
          exact: true,
        })
        .click()
      await expect(page).toHaveURL(/\/download$/)
      await page
        .getByRole("button", {
          name: "同意撤回書の控え：PDFをダウンロード",
          exact: true,
        })
        .click()
    } else {
      await page
        .getByRole("button", {
          name: "同意撤回書の取得を再試行",
          exact: true,
        })
        .click()
    }
    expect((await downloading).suggestedFilename()).toBe(
      reload
        ? "AERPP-withdrawal-synthetic-withdrawal.pdf"
        : "AERPP-Withdrawal.pdf",
    )
    if (reload) await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole("link", {
        name: "同意履歴・関連書類（同意撤回書の控え）",
        exact: true,
      }),
    ).toBeVisible()
    expect((await localServices.state()).withdrawalHashes.length).toBe(before)
  })
}

test("withdrawal before completion stays terminal across reload and cleanup", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await openWithdrawal(page)
  await localServices.scenario({ withdrawalFailure: "pending" })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await localServices.scenario({})
  await page
    .getByRole("button", { name: "データ削除の再試行", exact: true })
    .click()
  await expect(
    page.getByRole("heading", {
      name: "研究参加の撤回を受け付けました",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  const hashes = (await localServices.state()).withdrawalHashes
  expect(hashes.length).toBeGreaterThan(1)
  expect(new Set(hashes).size).toBe(1)
})

test("withdrawal stays terminal through cleanup failures and retries the original request after reload", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  const downloads: string[] = []
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  )
  await openWithdrawal(page)
  await localServices.scenario({ withdrawalFailure: "pending" })
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveCount(0)
  expect(await readStoredResult(page)).toBeNull()
  await expect.poll(() => downloads).toEqual(["AERPP-Withdrawal.pdf"])

  await localServices.scenario({ withdrawalFailure: "failed" })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
  ).toBeVisible()
  await expect(
    page.getByText("データの消去はまだ完了していません", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: "メールアドレス", exact: true }),
  ).toHaveCount(0)
  const retry = page.getByRole("button", {
    name: "データ削除の再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await localServices.scenario({})
  await retry.click()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("ブラウザーを閉じて構いません。", { exact: false }),
  ).toBeVisible()
  expect(downloads).toEqual(["AERPP-Withdrawal.pdf"])
  const hashes = (await localServices.state()).withdrawalHashes
  expect(hashes.length).toBeGreaterThanOrEqual(3)
  expect(new Set(hashes).size).toBe(1)
  await page.reload()
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).withdrawalHashes).toHaveLength(
    hashes.length,
  )
  await page.goto("/download")
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    })
    .click()
  expect((await downloading).suggestedFilename()).toBe(
    "AERPP-withdrawal-synthetic-withdrawal.pdf",
  )
  expect(downloads).toEqual([
    "AERPP-Withdrawal.pdf",
    "AERPP-withdrawal-synthetic-withdrawal.pdf",
  ])
  expect((await localServices.state()).withdrawalHashes).toHaveLength(
    hashes.length,
  )
})

test("leaving a pending withdrawal preserves the destination and suppresses its automatic PDF download", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await openWithdrawal(page)
  await localServices.scenario({ holdWithdrawal: true })
  const downloads: string[] = []
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  )
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).withdrawalHashes.length)
    .toBe(1)
  await page
    .getByRole("link", { name: "同意履歴・関連書類", exact: true })
    .click()
  await expect(page).toHaveURL(/\/download$/)
  await localServices.release()
  await waitForSessionIdle(page)
  await expect(
    page.getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeEnabled()
  expect(downloads).toEqual([])
  await expect(page).toHaveURL(/\/download$/)
  await page.goto("/")
  await expect(
    page.getByRole("link", {
      name: "同意履歴・関連書類（同意撤回書の控え）",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "書類の取得を終えて開始画面へ戻る",
      exact: true,
    }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "研究参加の撤回を受け付けました" }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "support@example.invalid", exact: true }),
  ).toHaveAttribute("href", "mailto:support@example.invalid")
  expect(downloads).toEqual([])
})

test("retries local result storage after committed finalization without another metadata write", async ({
  page,
  localServices,
}, testInfo) => {
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await setStorageFailure(page, "setItem", true)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "完了処理を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await expect(
    page.getByText("解析結果を保持しています。完了処理を再試行してください。", {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("暗号化して保存しています", { exact: false }),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "解析結果", exact: true }),
    })
    .screenshot({
      path: testInfo.outputPath("result-storage-pending-mobile.png"),
    })
  const before = await localServices.state()
  expect(before.calls["/v1/responses"]).toBe(1)
  await setStorageFailure(page, "setItem", false)
  await retry.click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("暗号化して保存しています", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("解析結果を保持しています。完了処理を再試行してください。", {
      exact: false,
    }),
  ).toHaveCount(0)
  const after = await localServices.state()
  expect(after.calls["/v1/responses"]).toBe(1)
  expect(after.calls["/api/participant/analysis-completion"]).toBe(1)
  expect(after.calls["/api/participant/analysis-completion"]).toBe(
    before.calls["/api/participant/analysis-completion"],
  )
  await page.reload()
  await expect(
    page.getByRole("button", { name: "アンケートを開く", exact: true }),
  ).toBeVisible()
})

test("blocked result restoration preserves the sealed value and allows reload recovery", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  const sealed = await readStoredResult(page)
  expect(sealed).not.toBeNull()
  // A fresh document must encounter the failure before AppContext hydrates.
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      if (
        key === "state" &&
        sessionStorage.getItem("e2e-block-result-read") === "1"
      )
        throw new DOMException("Synthetic read failure", "SecurityError")
      return original.call(this, key)
    }
  })
  await page.evaluate(() =>
    sessionStorage.setItem("e2e-block-result-read", "1"),
  )
  await page.reload()
  await expect(
    page.getByRole("button", { name: "セッションの確認を再試行", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toHaveCount(0)
  await page.evaluate(() => sessionStorage.removeItem("e2e-block-result-read"))
  expect(await readStoredResult(page)).toBe(sealed)
  await page
    .getByRole("button", { name: "セッションの確認を再試行", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("survey storage failure prevents sending and explicit deletion can be retried without resending", async ({
  page,
  localServices,
}) => {
  await openSurvey(page)
  const sealed = await readStoredResult(page)
  await setStorageFailure(page, "setItem", true)
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
  expect(await readStoredResult(page)).toBe(sealed)
  await expect(page.getByRole("combobox").first()).toBeEnabled()
  await setStorageFailure(page, "setItem", false)
  await setStorageFailure(page, "removeItem", true)
  await submit.click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/api/participant/survey"]).toBe(1)
  const clear = page.getByRole("button", {
    name: "ブラウザー内の一時データを消去する",
    exact: true,
  })
  await clear.click()
  await expect(
    page.getByRole("status").filter({ hasText: "消去を完了できませんでした" }),
  ).toBeVisible()
  await setStorageFailure(page, "removeItem", false)
  await clear.click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  expect(await readStoredResult(page)).toBeNull()
  expect((await localServices.state()).calls["/api/participant/survey"]).toBe(1)
})

test("leaving an active analysis preserves it and returning receives the same result", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await localServices.scenario({ holdAnalysis: true })
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  await page
    .getByRole("link", { name: "同意履歴・関連書類", exact: true })
    .click()
  await expect(page).toHaveURL(/\/download$/)
  expect((await localServices.state()).abortedAnalyses).toBe(0)
  await localServices.release()
  await page.goBack()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("a survey failure arriving after navigation leaves the destination notice and frozen answers intact", async ({
  page,
  localServices,
}) => {
  await openSurvey(page)
  await localServices.scenario({ holdSurvey: true, failSurveyOnce: true })
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).surveyHashes.length)
    .toBe(1)
  await page.getByRole("link", { name: "ライセンス情報", exact: true }).click()
  await expect(page).toHaveURL(/\/license$/)
  await localServices.release()
  await waitForSessionIdle(page)
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "アンケートの送信に失敗しました" }),
  ).toHaveCount(0)
  await localServices.scenario({})
  await page.goBack()
  await expect(
    page.getByText("送信を試みた回答を保持しています。", { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole("radio").first()).toBeDisabled()
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "ご協力ありがとうございました" }),
  ).toBeVisible()
  const hashes = (await localServices.state()).surveyHashes
  expect(hashes).toHaveLength(2)
  expect(hashes[0]).toBe(hashes[1])
})

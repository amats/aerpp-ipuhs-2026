import {
  readBrowserScope,
  readStoredResult,
  writeStoredResult,
} from "../test-support/e2e/browser-state"
import { DOCUMENT_TEXT, RESULT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  analyzeDocument,
  currentSessionToken,
  documentInput,
  expect,
  fillSurvey,
  openConsent,
  openDocuments,
  sendConsent,
  test,
} from "../test-support/e2e/fixtures"

for (const width of [1440, 390]) {
  test(`debug snapshots and controls remain usable without exposing participant content at ${width}px`, async ({
    page,
    localServices,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await analyzeDocument(page)
    const storedResult = await readStoredResult(page)
    expect(storedResult).not.toBeNull()
    const consentId = (await localServices.state()).consentIds.at(-1)
    expect(consentId).toBeDefined()
    const sensitiveValues = [
      DOCUMENT_TEXT,
      RESULT_TEXT,
      "participant@example.invalid",
      storedResult as string,
      consentId as string,
    ]
    async function checkSnapshot() {
      const text = await page.getByRole("main").innerText()
      for (const value of sensitiveValues) expect(text).not.toContain(value)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    }

    await page.getByRole("link", { name: "Debug", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Runtime debug snapshot" }),
    ).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Server snapshot", exact: true }),
    ).toContainText('"stage": "authenticated"')
    const serverSnapshot = page.getByRole("region", {
      name: "Server snapshot",
      exact: true,
    })
    await expect(serverSnapshot).toContainText('"questionnaireKind": "initial"')
    await expect(serverSnapshot).toContainText('"surveyAccepted": false')
    await expect(serverSnapshot).not.toContainText("surveyCount")
    await expect(
      page.getByRole("region", { name: "App context client snapshot" }),
    ).toContainText('"status": "available"')
    await checkSnapshot()
    await page.screenshot({
      path: testInfo.outputPath("runtime-debug.png"),
      fullPage: true,
    })
    const before = (await localServices.state()).calls[
      "/api/participant/participation-events"
    ]
    await page.getByRole("button", { name: "再読み込み", exact: true }).click()
    await expect
      .poll(
        async () =>
          (await localServices.state()).calls[
            "/api/participant/participation-events"
          ],
      )
      .toBeGreaterThan(before)

    await page
      .getByRole("link", { name: "Home Flow Debug", exact: true })
      .click()
    const homeSnapshot = page.getByRole("region", {
      name: "Home flow client snapshot",
    })
    await expect(homeSnapshot).toContainText('"hasResult": true')
    await expect(homeSnapshot).toContainText('"browserResult": "present"')
    await expect(homeSnapshot).toContainText('"sessionAdmission": "ready"')
    await expect(homeSnapshot).toContainText('"resultSurveySubmitted": false')
    await expect(homeSnapshot).toContainText('"recoveredSurvey": false')
    await expect(homeSnapshot).not.toContainText("analysisPreparationCount")
    await checkSnapshot()
    await page.screenshot({
      path: testInfo.outputPath("home-flow-debug.png"),
      fullPage: true,
    })

    await page
      .getByRole("link", { name: "Alert Message Debug", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "AlertMessage / 入力エラー" }),
    ).toBeVisible()
    const dismiss = page.getByRole("button", { name: "閉じる", exact: true })
    await expect(dismiss).toHaveCount(8)
    await dismiss.first().click()
    await expect(dismiss).toHaveCount(4)
    await page.getByRole("button", { name: "再表示", exact: true }).click()
    await expect(dismiss).toHaveCount(8)
    await checkSnapshot()
    await page.screenshot({
      path: testInfo.outputPath("alert-message-debug.png"),
      fullPage: true,
    })

    await page.getByRole("link", { name: "Reset", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "保存データを初期化する" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "初期化する", exact: true }),
    ).toBeEnabled()
    await expect(
      page.getByRole("button", {
        name: "サーバー履歴も含めて初期化する",
        exact: true,
      }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("debug-reset.png"),
      fullPage: true,
    })
    expect(await readStoredResult(page)).toBe(storedResult)
  })
}

test("a late ordinary response preserves the cookie of a fresh reset session", async ({
  page,
  context,
}) => {
  await openConsent(page)
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await expect(
    page.getByRole("button", { name: "同意する", exact: true }),
  ).toBeEnabled()
  const ready = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const delivered = Promise.withResolvers<void>()
  await page.route("**/*", async (route) => {
    if (
      !route.request().headers()["next-action"] ||
      !route.request().postData()?.includes("participant@example.invalid")
    ) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    expect(response.headers()["set-cookie"]).toBeUndefined()
    ready.resolve()
    await released.promise
    await route.fulfill({ response })
    delivered.resolve()
  })
  try {
    await page.getByRole("button", { name: "同意する", exact: true }).click()
    await ready.promise
    const other = await context.newPage()
    await other.goto("/reset")
    await other.getByRole("button", { name: "初期化する", exact: true }).click()
    await expect(other).toHaveURL(/\/$/)
    await expect(
      other.getByRole("heading", { name: "このシステムについて" }),
    ).toBeVisible()
    const freshCookie = (await context.cookies()).find((cookie) =>
      cookie.name.startsWith("aerpp-session-"),
    )?.value
    expect(freshCookie).toBeDefined()
    released.resolve()
    await delivered.promise
    expect(
      (await context.cookies()).find((cookie) =>
        cookie.name.startsWith("aerpp-session-"),
      )?.value,
    ).toBe(freshCookie)
    await other.reload()
    await expect(
      other.getByRole("heading", { name: "このシステムについて" }),
    ).toBeVisible()
  } finally {
    released.resolve()
  }
})

for (const intent of ["withdraw", "reset"] as const) {
  test(`same-tab ${intent === "withdraw" ? "withdrawal stays blocked" : "reset dispatches"} during a held authentication response`, async ({
    page,
    localServices,
  }) => {
    await sendConsent(page)
    await localServices.scenario({ holdAuthentication: true })
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await expect
      .poll(
        async () =>
          (await localServices.state()).calls[
            "/api/participant/verify-authentication"
          ],
      )
      .toBe(1)
    await page.getByRole("link", { name: "同意の撤回", exact: true }).click()
    await expect(page).toHaveURL(/\/withdraw$/, { timeout: 3000 })
    if (intent === "withdraw") {
      await expect(
        page.getByText("同意の撤回はメール認証の完了後", { exact: false }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "同意を撤回する", exact: true }),
      ).toHaveCount(0)
      expect((await localServices.state()).withdrawalHashes).toHaveLength(0)
      await localServices.release()
    } else {
      await page.goto("/reset")
      await page
        .getByRole("button", { name: "初期化する", exact: true })
        .click()
      await expect(page).toHaveURL(/\/$/, { timeout: 3000 })
      await expect(
        page.getByRole("heading", { name: "このシステムについて" }),
      ).toBeVisible()
      expect(
        (await localServices.state()).calls[
          "/api/participant/verify-authentication"
        ],
      ).toBe(1)
      await localServices.release()
      await expect(
        page.getByRole("heading", { name: "このシステムについて" }),
      ).toBeVisible()
    }
  })
}

test("a delayed reset response preserves the fresh generation and its saved data", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    }),
  )
  await sendConsent(page)
  await page.goto("/reset")
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const done = Promise.withResolvers<void>()
  await page.route("**/reset", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue()
    const response = await route.fetch()
    if (!response.headers()["set-cookie"]) return route.fulfill({ response })
    const delayedResponse = {
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    }
    ready.resolve()
    await release.promise
    await route.fulfill(delayedResponse)
    done.resolve()
  })
  try {
    await page.getByRole("button", { name: "初期化する", exact: true }).click()
    await ready.promise
    const other = await context.newPage()
    await other.goto("/reset")
    await other.getByRole("button", { name: "初期化する", exact: true }).click()
    await expect(
      other.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible()
    const scope = await readBrowserScope(other)
    const name = `aerpp-session-${scope}`
    const fresh = (await context.cookies()).find(
      (cookie) => cookie.name === name,
    )?.value
    await writeStoredResult(other, "synthetic-fresh-result")
    expect(fresh).toBeDefined()
    // Keep the old reset on a departed route, so it cannot mask cookie deletion
    // by navigating home and immediately creating yet another handle.
    await page
      .getByRole("link", { name: "同意履歴・関連書類", exact: true })
      .click()
    await expect(page).toHaveURL(/\/download$/)
    release.resolve()
    await done.promise
    await expect
      .poll(
        async () =>
          (await context.cookies()).find((cookie) => cookie.name === name)
            ?.value,
      )
      .toBe(fresh)
    expect(await readStoredResult(other)).toBe("synthetic-fresh-result")
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("a delayed initial admission cannot replace the fresh generation after reset", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    }),
  )
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const done = Promise.withResolvers<void>()
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue()
    const response = await route.fetch()
    if (!response.headers()["set-cookie"]) return route.fulfill({ response })
    ready.resolve()
    await release.promise
    await route.fulfill({ response })
    done.resolve()
  })
  try {
    await page.goto("/")
    await ready.promise
    const other = await context.newPage()
    await other.goto("/reset")
    await other.getByRole("button", { name: "初期化する", exact: true }).click()
    await expect(
      other.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible()
    const scope = await readBrowserScope(other)
    const name = `aerpp-session-${scope}`
    const fresh = (await context.cookies()).find(
      (cookie) => cookie.name === name,
    )?.value
    await writeStoredResult(other, "synthetic-fresh-result")
    expect(fresh).toBeDefined()
    release.resolve()
    await done.promise
    await expect
      .poll(
        async () =>
          (await context.cookies()).find((cookie) => cookie.name === name)
            ?.value,
      )
      .toBe(fresh)
    expect(await readStoredResult(other)).toBe("synthetic-fresh-result")
    await expect
      .poll(() => readStoredResult(other))
      .toBe("synthetic-fresh-result")
    await other.reload()
    await other.getByRole("button", { name: "次に進む", exact: true }).click()
    await expect(
      other.getByRole("button", { name: "同意画面へ進む" }),
    ).toBeVisible()
  } finally {
    release.resolve()
  }
})

test("the earlier of two pending resets cannot clear data or admit a new session", async ({
  page,
  context,
}) => {
  await sendConsent(page)
  await page.goto("/reset")
  const other = await context.newPage()
  await other.goto("/reset")
  // Finish both serialized admissions before revoking the shared generation.
  // Otherwise a late admission can correctly recover it during this scenario.
  await currentSessionToken(other)
  const scope = await readBrowserScope(page)
  const pending = [page, other].map(() => ({
    ready: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
    done: Promise.withResolvers<void>(),
  }))
  for (const [index, current] of [page, other].entries()) {
    await current.route("**/*", async (route) => {
      if (
        !route.request().headers()["next-action"] ||
        !route
          .request()
          .postData()
          ?.startsWith(`${JSON.stringify([scope]).slice(0, -1)},`)
      )
        return route.continue()
      const response = await route.fetch()
      pending[index].ready.resolve()
      await pending[index].release.promise
      await route.fulfill({ response })
      pending[index].done.resolve()
    })
  }
  try {
    await page.evaluate(async () => {
      localStorage.setItem("reset-retained", "before-confirmation")
      await caches.open("synthetic-overlap-reset-cache")
    })
    await page.getByRole("button", { name: "初期化する", exact: true }).click()
    await pending[0].ready.promise
    await other.getByRole("button", { name: "初期化する", exact: true }).click()
    await pending[1].ready.promise
    pending[0].release.resolve()
    await pending[0].done.promise
    await expect(
      page.getByRole("button", { name: "初期化する", exact: true }),
    ).toBeEnabled()
    expect(
      await page.evaluate(() => localStorage.getItem("reset-retained")),
    ).toBe("before-confirmation")
    expect(await page.evaluate(() => caches.keys())).toContain(
      "synthetic-overlap-reset-cache",
    )
    const waiting = await context.newPage()
    await waiting.goto("/")
    await expect(
      waiting.getByRole("button", {
        name: "セッションの確認を再試行",
        exact: true,
      }),
    ).toBeVisible()
    pending[1].release.resolve()
    await pending[1].done.promise
    await expect(
      other.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible()
    expect(
      await other.evaluate(() => localStorage.getItem("reset-retained")),
    ).toBeNull()
    expect(await other.evaluate(() => caches.keys())).not.toContain(
      "synthetic-overlap-reset-cache",
    )
  } finally {
    for (const item of pending) item.release.resolve()
  }
})

test("generation reset works when localStorage cannot accept writes until cleared", async ({
  page,
}) => {
  await sendConsent(page)
  await page.goto("/reset")
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem
    const originalClear = Storage.prototype.clear
    Storage.prototype.setItem = () => {
      throw new DOMException("Synthetic quota exhaustion", "QuotaExceededError")
    }
    Storage.prototype.clear = function () {
      originalClear.call(this)
      Storage.prototype.setItem = originalSet
      Storage.prototype.clear = originalClear
    }
  })
  await page.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "このシステムについて" }),
  ).toBeVisible()
})

test("a late withdrawal response cannot clear the replacement's result before storage notification", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const NativeChannel = window.BroadcastChannel
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name: string) {
        super(name)
        this.addEventListener("message", (event) =>
          event.stopImmediatePropagation(),
        )
      }
    }
    window.addEventListener(
      "focus",
      (event) => event.stopImmediatePropagation(),
      true,
    )
  })
  await openDocuments(page)
  await page.getByRole("link", { name: "同意の撤回", exact: true }).click()
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const done = Promise.withResolvers<void>()
  await page.route("**/*", async (route) => {
    if (
      !route.request().headers()["next-action"] ||
      !route.request().postData()?.includes("participant@example.invalid")
    )
      return route.continue()
    const response = await route.fetch()
    ready.resolve()
    await release.promise
    await route.fulfill({ response })
    done.resolve()
  })
  try {
    await page
      .getByRole("textbox", { name: "メールアドレス", exact: true })
      .fill("participant@example.invalid")
    await page
      .getByRole("button", { name: "同意を撤回する", exact: true })
      .click()
    await ready.promise
    const other = await context.newPage()
    await other.goto("/reset")
    await other.getByRole("button", { name: "初期化する", exact: true }).click()
    await expect(
      other.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible()
    await writeStoredResult(other, "synthetic-replacement")
    release.resolve()
    await done.promise
    await expect(
      page.getByRole("button", { name: "送信しています...", exact: true }),
    ).toHaveCount(0)
    expect(await readStoredResult(other)).toBe("synthetic-replacement")
  } finally {
    release.resolve()
  }
})

test("reset reports blocked coordination deletion before the connection closes and can retry", async ({
  page,
}) => {
  await page.goto("/reset")
  await currentSessionToken(page)
  await page.evaluate(async () => {
    localStorage.setItem("blocked-reset-probe", "retained-until-retry")
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("aerpp-session-coordination", 2)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        // Keep this real connection open until the failure UI has appeared.
        window.addEventListener(
          "aerpp-test-release-reset-database",
          () => database.close(),
          { once: true },
        )
        resolve()
      }
    })
  })
  const resetButton = page.getByRole("button", {
    name: "初期化する",
    exact: true,
  })
  try {
    await resetButton.click()
    await expect(
      page.getByText("保存データを初期化できませんでした。", { exact: false }),
    ).toBeVisible({ timeout: 3000 })
    await expect(resetButton).toBeEnabled()
    await expect(page).toHaveURL(/\/reset$/)
    expect(
      await page.evaluate(() => localStorage.getItem("blocked-reset-probe")),
    ).toBe("retained-until-retry")
  } finally {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("aerpp-test-release-reset-database")),
    )
  }
  await resetButton.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => localStorage.getItem("blocked-reset-probe")),
  ).toBeNull()
})

test("reset deletes stored data and session cookies and revokes the old session", async ({
  page,
  context,
}) => {
  await sendConsent(page)
  const oldCookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("aerpp-session-"),
  )
  expect(oldCookies.length).toBeGreaterThan(0)
  const oldToken = await currentSessionToken(page)
  if (!oldToken) throw new Error("Missing original tab token")
  const headers = {
    cookie: oldCookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    "x-aerpp-tab": oldToken,
  }
  const before = await context.request.post("/api/session-status", { headers })
  expect(before.ok()).toBe(true)
  expect((await before.json()).stepState.stage).toBe("confirmation_sent")
  await page.evaluate(() => localStorage.setItem("reset-probe", "synthetic"))
  await page.goto("/reset")
  await page.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", { name: "このシステムについて" }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => localStorage.getItem("reset-probe")),
  ).toBeNull()
  const remaining = await context.cookies()
  for (const oldCookie of oldCookies)
    expect(remaining.some(({ name }) => name === oldCookie.name)).toBe(false)
  const replay = await context.request.post("/api/session-status", { headers })
  expect(replay.ok()).toBe(false)
  expect(await replay.json()).toBeNull()
  const newToken = await currentSessionToken(page)
  if (!newToken) throw new Error("Missing replacement tab token")
  const fresh = await context.request.post("/api/session-status", {
    headers: { "x-aerpp-tab": newToken },
  })
  expect(fresh.ok()).toBe(true)
  expect((await fresh.json()).stepState).toEqual({
    stage: "unauthenticated",
    step: "start",
  })
})

for (const pendingSubmission of [false, true]) {
  test(`reset clears completed results, documents and ${pendingSubmission ? "frozen" : "draft"} answers`, async ({
    page,
    context,
    localServices,
  }) => {
    if (pendingSubmission)
      await localServices.scenario({ failSurveyOnce: true })
    await analyzeDocument(page)
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await fillSurvey(page)
    if (pendingSubmission) {
      await page
        .getByRole("button", { name: "アンケートを送信", exact: true })
        .click()
      await expect(
        page.getByText("送信を試みた回答を保持しています。", { exact: false }),
      ).toBeVisible()
    }
    expect(await readStoredResult(page)).not.toBeNull()
    const resetTab = await context.newPage()
    await resetTab.goto("/reset")
    await resetTab
      .getByRole("button", { name: "初期化する", exact: true })
      .click()
    await expect(
      resetTab.getByRole("heading", { name: "このシステムについて" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "ページを再読み込み", exact: true }),
    ).toBeVisible()
    expect(await readStoredResult(resetTab)).toBeNull()
    expect(
      await resetTab.evaluate(() =>
        sessionStorage.getItem("aerpp-survey-view"),
      ),
    ).toBeNull()

    await openDocuments(resetTab, { navigate: false })
    await expect(documentInput(resetTab)).toHaveValue("")
    await documentInput(resetTab).fill(DOCUMENT_TEXT)
    await resetTab
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect(
      resetTab.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    await resetTab
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await expect(resetTab.getByRole("combobox").first()).toHaveValue("")
    await expect(resetTab.locator('input[type="radio"]:checked')).toHaveCount(0)
    for (const input of await resetTab.locator("form textarea").all())
      await expect(input).toHaveValue("")
    await expect(
      resetTab.getByText("送信を試みた回答を保持しています。", {
        exact: false,
      }),
    ).toHaveCount(0)
    expect(
      (await localServices.state()).calls["/api/participant/survey"] ?? 0,
    ).toBe(pendingSubmission ? 1 : 0)
  })
}

test("reset in another tab invalidates an active analysis and fences its old cookie", async ({
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
  const oldToken = await currentSessionToken(page)
  const oldCookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("aerpp-session-"),
  )
  if (!oldToken) throw new Error("Missing active tab token")
  const resetTab = await context.newPage()
  await resetTab.goto("/reset")
  await resetTab
    .getByRole("button", { name: "初期化する", exact: true })
    .click()
  await expect(
    resetTab.getByRole("heading", {
      name: "このシステムについて",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("heading", { name: "このシステムについて", exact: true })
      .or(
        page.getByRole("button", { name: "ページを再読み込み", exact: true }),
      ),
  ).toBeVisible()
  await expect
    .poll(async () => (await localServices.state()).abortedAnalyses)
    .toBeGreaterThan(0)
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toBeVisible()
  const response = await context.request.post("/api/session-status", {
    headers: {
      cookie: oldCookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
      "x-aerpp-tab": oldToken,
    },
  })
  expect(response.ok()).toBe(false)
  await localServices.release()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toHaveCount(0)
  expect(await readStoredResult(resetTab)).toBeNull()
  await expect(
    resetTab.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeEnabled()
})
test("reset before authentication returns to start and permits fresh consent", async ({
  page,
  localServices,
}) => {
  await sendConsent(page)
  const initial = await localServices.state()
  await localServices.scenario({ failAuthentication: true })
  await page.goto("/reset")
  await page.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("button", { name: "次に進む", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toHaveCount(0)
  expect(
    (await localServices.state()).calls[
      "/api/participant/verify-authentication"
    ] ?? 0,
  ).toBe(initial.calls["/api/participant/verify-authentication"] ?? 0)
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await page.getByRole("button", { name: "同意画面へ進む" }).click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("checkbox").first()).toBeVisible()
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check()
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
  const renewed = await localServices.state()
  expect(new Set(renewed.consentIds).size).toBe(2)
})

test("authenticated reset clears local data and starts again while Support is unavailable", async ({
  page,
  context,
  localServices,
}) => {
  await openDocuments(page)
  const before = await context.cookies()
  const oldCookies = before.filter((cookie) =>
    cookie.name.startsWith("aerpp-session-"),
  )
  expect(oldCookies.length).toBeGreaterThan(0)
  await context.addCookies([
    {
      name: "synthetic-reset-cookie",
      value: "retained-until-reset",
      url: page.url(),
      httpOnly: true,
    },
  ])
  await page.evaluate(async () => {
    localStorage.setItem("synthetic-reset-marker", "retained-until-reset")
    sessionStorage.setItem("synthetic-reset-marker", "retained-until-reset")
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("synthetic-reset-database")
      request.onupgradeneeded = () => request.result.createObjectStore("data")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
    const cache = await caches.open("synthetic-reset-cache")
    await cache.put("/synthetic-reset", new Response("retained-until-reset"))
    // An extra record survives ordinary participant cleanup, but not DB deletion.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("aerpp-session-coordination")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction("coordination", "readwrite")
        transaction.objectStore("coordination").put("retained", "reset-probe")
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onabort = () => {
          database.close()
          reject(transaction.error)
        }
      }
    })
    const directory = await navigator.storage.getDirectory()
    const nested = await directory.getDirectoryHandle("reset-probe", {
      create: true,
    })
    await nested.getFileHandle("saved.txt", { create: true })
  })
  await localServices.scenario({ failAuthentication: true })
  const callsBefore = (await localServices.state()).calls
  await page.goto("/reset")
  await page.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => localStorage.getItem("synthetic-reset-marker")),
  ).toBeNull()
  const cookiesAfter = await context.cookies()
  expect(
    cookiesAfter.some((cookie) => cookie.name === "synthetic-reset-cookie"),
  ).toBe(false)
  expect(
    await page.evaluate(async () => {
      const files: string[] = []
      for await (const name of (await navigator.storage.getDirectory()).keys())
        files.push(name)
      return {
        session: sessionStorage.getItem("synthetic-reset-marker"),
        databases: (await indexedDB.databases()).map(({ name }) => name),
        caches: await caches.keys(),
        files,
        retainedCoordinationRecord: await new Promise((resolve, reject) => {
          const request = indexedDB.open("aerpp-session-coordination")
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction("coordination", "readonly")
            const reading = transaction
              .objectStore("coordination")
              .get("reset-probe")
            transaction.oncomplete = () => {
              database.close()
              resolve(reading.result ?? null)
            }
            transaction.onabort = () => {
              database.close()
              reject(transaction.error)
            }
          }
        }),
      }
    }),
  ).toEqual({
    session: null,
    databases: expect.not.arrayContaining(["synthetic-reset-database"]),
    caches: expect.not.arrayContaining(["synthetic-reset-cache"]),
    files: [],
    retainedCoordinationRecord: null,
  })
  for (const cookie of oldCookies)
    expect(cookiesAfter.some((current) => current.name === cookie.name)).toBe(
      false,
    )
  const callsAfter = (await localServices.state()).calls
  expect(callsAfter["/api/participant/verify-authentication"] ?? 0).toBe(
    callsBefore["/api/participant/verify-authentication"] ?? 0,
  )
})

test("another tab can force reset active analysis without allowing its late result", async ({
  page,
  context,
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
  const other = await context.newPage()
  await other.goto("/reset")
  await other.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(other).toHaveURL("/")
  await expect(
    other.getByRole("heading", { name: "このシステムについて" }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toBeVisible()
  await localServices.release()
  await expect
    .poll(async () => (await localServices.state()).abortedAnalyses)
    .toBe(1)
  expect(await readStoredResult(other)).toBeNull()
  await other.reload()
  await expect(
    other.getByRole("heading", { name: "このシステムについて" }),
  ).toBeVisible()
})

test("debug reset requires fresh consent and authentication after follow-up", async ({
  page,
  localServices,
}) => {
  await analyzeDocument(page)
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await fillSurvey(page)
  await page
    .getByRole("button", { name: "アンケートを送信", exact: true })
    .click()
  const progress = page.getByRole("navigation", { name: "進行中のステップ" })
  await expect(
    progress.getByText("Follow up Session", { exact: true }),
  ).toBeVisible()
  await expect(progress.locator("ol")).toHaveCount(0)
  await page.goto("/debug")
  const acceptedSnapshot = page.getByRole("region", {
    name: "Server snapshot",
    exact: true,
  })
  await expect(acceptedSnapshot).toContainText(
    '"questionnaireKind": "follow-up"',
  )
  await expect(acceptedSnapshot).toContainText('"surveyAccepted": true')
  await page.goto("/debug/home-flow")
  await expect(
    page.getByRole("region", { name: "Home flow client snapshot" }),
  ).toContainText('"resultSurveySubmitted": true')
  await page.goto("/reset")
  await page.getByRole("button", { name: "初期化する", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", { name: "このシステムについて", exact: true }),
  ).toBeVisible()
  await expect(
    progress.getByText("Follow up Session", { exact: true }),
  ).toHaveCount(0)
  await analyzeDocument(page, { navigate: false })
  await expect(
    progress.getByText("Follow up Session", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "アンケートの回答と送信", exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).withdrawalHashes).toHaveLength(0)
  expect((await localServices.state()).surveyHashes).toHaveLength(1)
})

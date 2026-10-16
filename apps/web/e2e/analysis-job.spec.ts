import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import {
  documentInput,
  expect,
  openDocuments,
  test,
} from "../test-support/e2e/fixtures"

test("elapsed display ticks steadily despite status timing corrections", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const elapsed = page.getByText(/経過時間/)
  await expect(elapsed).toBeVisible()

  let correctedSamples = 0
  await page.route("**/api/llm/analysis", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const status = await response.json()
    if (status.status !== "running") return route.fulfill({ response })
    correctedSamples += 1
    await route.fulfill({
      response,
      json: { ...status, elapsedMs: correctedSamples % 2 === 1 ? 120_000 : 0 },
    })
  })

  const readings = await elapsed.evaluate(
    (element) =>
      new Promise<{ seconds: number; atMs: number }[]>((resolve, reject) => {
        function read() {
          const match = element.textContent?.match(/(\d+)分(\d+)秒/)
          if (!match) throw new Error("Missing elapsed display")
          return {
            seconds: Number(match[1]) * 60 + Number(match[2]),
            atMs: performance.now(),
          }
        }
        const samples = [read()]
        const observer = new MutationObserver(() => {
          const sample = read()
          if (sample.seconds === samples[samples.length - 1].seconds) return
          samples.push(sample)
          if (samples.length < 6) return
          observer.disconnect()
          clearTimeout(deadline)
          resolve(samples)
        })
        const deadline = setTimeout(() => {
          observer.disconnect()
          reject(new Error("Elapsed display did not keep ticking"))
        }, 10_000)
        observer.observe(element, {
          childList: true,
          characterData: true,
          subtree: true,
        })
      }),
  )
  expect(correctedSamples).toBeGreaterThanOrEqual(2)
  for (let index = 1; index < readings.length; index += 1) {
    expect(readings[index].seconds - readings[index - 1].seconds).toBe(1)
    if (index > 1)
      expect(
        readings[index].atMs - readings[index - 1].atMs,
      ).toBeGreaterThanOrEqual(850)
  }
  await localServices.release()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

for (const clockOffsetMs of [-120_000, 120_000]) {
  test(`elapsed time advances and survives reload with a browser clock offset of ${clockOffsetMs} ms`, async ({
    page,
    localServices,
  }) => {
    await page.addInitScript((offsetMs) => {
      const originalNow = Date.now.bind(Date)
      Date.now = () => originalNow() + offsetMs
    }, clockOffsetMs)
    await openDocuments(page)
    await localServices.scenario({ holdAnalysis: true })
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect
      .poll(async () => (await localServices.state()).sawDocument)
      .toBe(true)
    const elapsed = page.getByText(/経過時間/)
    const elapsedSeconds = async () => {
      const match = (await elapsed.textContent())?.match(/(\d+)分(\d+)秒/)
      return match ? Number(match[1]) * 60 + Number(match[2]) : -1
    }
    await expect(page.locator("[data-analysis-animation]")).toBeVisible()
    await expect.poll(elapsedSeconds).toBeGreaterThanOrEqual(2)
    const beforeReload = await elapsedSeconds()
    await page.reload()
    await expect.poll(elapsedSeconds).toBeGreaterThanOrEqual(beforeReload)
    await expect.poll(elapsedSeconds).toBeGreaterThan(beforeReload)
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
    await localServices.release()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  })
}

test("renders tab escapes as whitespace after analysis and stored-result reload", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({
    analysisText: "本文\\t区切り\\n次の行\n\n`コード\\t例`",
  })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  for (const reload of [false, true]) {
    if (reload === true) await page.reload()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    const result = page.locator(".prose")
    expect(await result.textContent()).toContain("本文\t区切り")
    await expect(result.locator("br")).toHaveCount(1)
    await expect(result.locator("code")).toHaveText("コード\\t例")
  }
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("a confirmed failure can retry the retained prompt after reload", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  await localServices.scenario({})
  await page.getByRole("button", { name: "解析を再試行", exact: true }).click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  const state = await localServices.state()
  expect(state.calls["/v1/responses"]).toBe(2)
  expect(state.analysisPromptHashes).toHaveLength(2)
  expect(new Set(state.analysisPromptHashes).size).toBe(1)
  expect(
    state.analysisAttempts
      .map((event) => event.outcome)
      .filter((outcome) => outcome !== "presented"),
  ).toEqual(["started", "failed", "started", "completed"])
})

test("failed terminal delivery can be retried after reload without another inference", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failAnalysis: true, failFailureRecord: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retryRecord = page.getByRole("button", {
    name: "終了記録を再試行",
    exact: true,
  })
  await expect(retryRecord).toBeVisible()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toHaveCount(0)
  await expect(page.locator("[data-analysis-animation]")).toHaveCount(0)
  await page.reload()
  await expect(retryRecord).toBeVisible()
  const before = await localServices.state()
  expect(before.calls["/v1/responses"]).toBe(1)
  const original = before.analysisAttempts.find(
    (event) => event.outcome === "failed",
  )
  expect(original).toBeDefined()
  await localServices.scenario({})
  await retryRecord.click()
  await expect(
    page.getByRole("button", { name: "解析を再試行", exact: true }),
  ).toBeVisible()
  const recorded = await localServices.state()
  expect(recorded.calls["/v1/responses"]).toBe(1)
  expect(
    recorded.analysisAttempts.filter((event) => event.outcome === "failed")
      .length,
  ).toBeGreaterThan(
    before.analysisAttempts.filter((event) => event.outcome === "failed")
      .length,
  )
  expect(
    recorded.analysisAttempts
      .filter((event) => event.outcome === "failed")
      .every((event) => JSON.stringify(event) === JSON.stringify(original)),
  ).toBe(true)
  await page.getByRole("button", { name: "解析を再試行", exact: true }).click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(2)
})

test("a lost result response is fetched again without another inference", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  let interrupted = false
  await page.route("**/api/llm/analysis/result?*", async (route) => {
    if (interrupted) return route.continue()
    await route.fetch()
    interrupted = true
    await route.abort("failed")
  })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "接続を再確認", exact: true }),
  ).toBeVisible()
  await expect(page.locator("[data-analysis-animation]")).toHaveCount(0)
  await page.getByRole("button", { name: "接続を再確認", exact: true }).click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("reload recovers output held on the server after browser storage failure", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === "state" && value.analysisResult?.value !== null)
        throw new DOMException("Synthetic quota", "QuotaExceededError")
      return original.call(this, value, key)
    }
  })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "完了処理を再試行", exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("explicit cancellation stops inference and retains the document draft", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  await page
    .getByRole("button", { name: "解析を中止する", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  await expect
    .poll(async () => (await localServices.state()).abortedAnalyses)
    .toBe(1)
  await expect
    .poll(async () =>
      (await localServices.state()).analysisAttempts.map(
        (event) => event.outcome,
      ),
    )
    .toContain("cancelled")
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("a delayed cancellation response preserves the draft without stale polling", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  const release = Promise.withResolvers<void>()
  let cancellationCommitted = false
  let latePolls = 0
  await page.route("**/api/llm/analysis", async (route) => {
    if (route.request().method() === "GET" && cancellationCommitted === true)
      latePolls += 1
    await route.continue()
  })
  await page.route("**/", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue()
    const response = await route.fetch()
    const body = await response.text()
    if (body.includes('"step":"document"')) {
      cancellationCommitted = true
      await release.promise
    }
    await route.fulfill({ response })
  })
  try {
    await page
      .getByRole("button", { name: "解析を中止する", exact: true })
      .click()
    await expect.poll(() => cancellationCommitted).toBe(true)
    // Keep the committed transition unacknowledged across two polling periods.
    await page.waitForTimeout(4_500)
    await expect(
      page.getByRole("button", { name: "中止を確認中...", exact: true }),
    ).toBeVisible()
    expect(latePolls).toBe(0)
    release.resolve()
    await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("cancellation waits for the admission token before stopping the accepted attempt", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  const release = Promise.withResolvers<void>()
  let admissionHeld = false
  let prematureMutations = 0
  page.on("request", (request) => {
    if (admissionHeld === true && request.headers()["next-action"])
      prematureMutations += 1
  })
  await page.route("**/api/llm/analysis", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    const response = await route.fetch()
    admissionHeld = true
    await release.promise
    admissionHeld = false
    await route.fulfill({ response })
  })
  try {
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect.poll(() => admissionHeld).toBe(true)
    await page
      .getByRole("button", { name: "解析を中止する", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "中止を確認中...", exact: true }),
    ).toBeVisible()
    release.resolve()
    await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
    expect(prematureMutations).toBe(0)
    await expect
      .poll(async () => (await localServices.state()).abortedAnalyses)
      .toBe(1)
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("unconfirmed cancellation before admission reconnects without submitting the draft", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  const release = Promise.withResolvers<void>()
  let readHeld = false
  let reads = 0
  await page.route("**/api/llm/analysis", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    reads += 1
    const response = await route.fetch()
    if (reads === 1) {
      readHeld = true
      await release.promise
    }
    await route.fulfill({ response })
  })
  try {
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect.poll(() => readHeld).toBe(true)
    await page.route("**/", async (route) => {
      if (route.request().headers()["next-action"]) return route.abort("failed")
      await route.continue()
    })
    await page
      .getByRole("button", { name: "解析を中止する", exact: true })
      .click()
    const reconnect = page.getByRole("button", {
      name: "接続を再確認",
      exact: true,
    })
    await expect(reconnect).toBeVisible()
    release.resolve()
    await reconnect.click()
    await expect.poll(() => reads).toBe(2)
    await expect(
      page.getByText(
        "解析の終了状態を確認できません。自動で再解析せず、接続を再確認してください。",
        { exact: true },
      ),
    ).toBeVisible()
    const state = await localServices.state()
    expect(state.calls["/v1/responses"] ?? 0).toBe(0)
    expect(state.analysisAttempts).toEqual([])
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("cancellation observes a completion that wins the race without another inference", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  const release = Promise.withResolvers<void>()
  let cancellationHeld = false
  let firstMutation = true
  await page.route("**/", async (route) => {
    if (!route.request().headers()["next-action"] || firstMutation !== true)
      return route.continue()
    firstMutation = false
    cancellationHeld = true
    await release.promise
    await route.continue()
  })
  try {
    await page
      .getByRole("button", { name: "解析を中止する", exact: true })
      .click()
    await expect.poll(() => cancellationHeld).toBe(true)
    await localServices.release()
    await expect
      .poll(async () =>
        (await localServices.state()).analysisAttempts.map(
          (attempt) => attempt.outcome,
        ),
      )
      .toContain("completed")
    release.resolve()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    const state = await localServices.state()
    expect(state.calls["/v1/responses"]).toBe(1)
    expect(
      state.analysisAttempts.map((attempt) => attempt.outcome),
    ).not.toContain("cancelled")
  } finally {
    release.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("terminal acknowledgement loss retries only the original completion record", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failTerminal: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "完了処理を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toHaveCount(0)
  await page.reload()
  await expect(retry).toBeEnabled()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  await localServices.scenario({})
  await retry.click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("stalled RAM acknowledgement does not delay output or survey navigation", async ({
  page,
  localServices,
}) => {
  let releaseAcknowledgement: (() => void) | undefined
  let acknowledgementStarted = false
  await page.route("**/api/llm/analysis/result?*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue()
    acknowledgementStarted = true
    await new Promise<void>((resolve) => {
      releaseAcknowledgement = resolve
    })
    await route.abort().catch(() => undefined)
  })
  try {
    await openDocuments(page)
    await documentInput(page).fill(DOCUMENT_TEXT)
    await page
      .getByRole("button", { name: "解析を開始する", exact: true })
      .click()
    await expect(
      page.getByText("解析が終了しました。", { exact: true }),
    ).toBeVisible()
    await expect.poll(() => acknowledgementStarted).toBe(true)
    expect(
      (await localServices.state()).analysisAttempts.map(
        (event) => event.outcome,
      ),
    ).toContain("presented")
    await page
      .getByRole("button", { name: "アンケートを開く", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "アンケートを送信", exact: true }),
    ).toBeVisible()
    expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  } finally {
    releaseAcknowledgement?.()
  }
})

test("output and RAM acknowledgement wait for confirmed Firestore presentation", async ({
  page,
  localServices,
}) => {
  let acknowledgements = 0
  page.on("request", (request) => {
    if (
      request.url().includes("/api/llm/analysis/result?") &&
      request.method() === "DELETE"
    )
      acknowledgements += 1
  })
  await openDocuments(page)
  await localServices.scenario({ failPresentation: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "完了処理を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await expect(
    page.getByText("保管期間を明記してください。", { exact: false }),
  ).toHaveCount(0)
  expect(acknowledgements).toBe(0)
  await localServices.scenario({})
  await retry.click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect.poll(() => acknowledgements).toBe(1)
  expect(
    (await localServices.state()).analysisAttempts.map(
      (event) => event.outcome,
    ),
  ).toContain("presented")
})

test("readiness failure preserves input without creating an attempt or invoking inference", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ failReadiness: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(page.getByText(/解析は開始していません/)).toBeVisible()
  const before = await localServices.state()
  expect(before.analysisAttempts).toEqual([])
  expect(before.calls["/v1/responses"] ?? 0).toBe(0)
  await page
    .getByRole("button", { name: "書類の準備へ戻る", exact: true })
    .click()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  await localServices.scenario({})
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
})

test("cancellation acknowledgement loss retains the original terminal for explicit retry", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  await localServices.scenario({ holdAnalysis: true, failCancellation: true })
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect
    .poll(async () => (await localServices.state()).calls["/v1/responses"])
    .toBe(1)
  await page
    .getByRole("button", { name: "解析を中止する", exact: true })
    .click()
  const retry = page.getByRole("button", {
    name: "終了記録を再試行",
    exact: true,
  })
  await expect(retry).toBeEnabled()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(1)
  const first = (await localServices.state()).analysisAttempts.find(
    (attempt) => attempt.outcome === "cancelled",
  )
  expect(first).toBeDefined()
  await localServices.scenario({})
  await retry.click()
  await page
    .getByRole("button", { name: "書類の準備へ戻る", exact: true })
    .click()
  await expect(documentInput(page)).toHaveValue(DOCUMENT_TEXT)
  const terminals = (await localServices.state()).analysisAttempts.filter(
    (attempt) => attempt.outcome === "cancelled",
  )
  expect(terminals.length).toBeGreaterThan(1)
  expect(
    terminals.every(
      (attempt) => JSON.stringify(attempt) === JSON.stringify(first),
    ),
  ).toBe(true)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  expect((await localServices.state()).calls["/v1/responses"]).toBe(2)
})

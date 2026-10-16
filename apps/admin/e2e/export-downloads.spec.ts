import { expect, test } from "@playwright/test"

type HeldExport = {
  controller: ReadableStreamDefaultController<Uint8Array> | null
  signal: AbortSignal | null
  reading: boolean
  settled: boolean
}

type ExportTestWindow = typeof window & { heldExports: HeldExport[] }

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  )
  await page.goto("/research")
})

for (const [dataset, name] of [
  ["research", "研究用データを保存（ZIP）"],
  ["access", "参加管理・アクセスデータを保存（ZIP）"],
]) {
  test(`${dataset} export shows progress and a safe retry after failure`, async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const downloads: string[] = []
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    )
    await page.route(
      `**/api/research/export?dataset=${dataset}&format=bundle`,
      async (route) => {
        calls++
        if (calls > 1) return route.fallback()
        await held
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "synthetic-private-error-must-not-be-shown",
        })
      },
    )
    try {
      const button = page.getByRole("button", { name, exact: true })
      await button.evaluate((element) => {
        ;(element as HTMLButtonElement).click()
        ;(element as HTMLButtonElement).click()
      })
      await expect(
        page.getByRole("button", { name: "ZIPを準備しています…", exact: true }),
      ).toBeDisabled()
      await expect(
        page.getByRole("status").filter({ hasText: "データを取得しています" }),
      ).toBeVisible()
      await expect.poll(() => calls).toBe(1)
      release()
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "出力は完了していません",
      )
      await expect(
        page.getByText("synthetic-private-error-must-not-be-shown"),
      ).toHaveCount(0)
      await expect(page).toHaveURL(/\/research$/)
      await expect(
        page.getByRole("navigation", { name: "メインナビゲーション" }),
      ).toBeVisible()
      expect(downloads).toEqual([])
      const downloading = page.waitForEvent("download")
      await button.click()
      const download = await downloading
      expect(await download.failure()).toBeNull()
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${dataset}-source-[a-f0-9-]+\\.zip$`),
      )
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
      await expect(
        page.getByText(
          "ダウンロードを開始しました。ブラウザーの保存状況を確認してください。",
          { exact: true },
        ),
      ).toBeVisible()
      expect(calls).toBe(2)
    } finally {
      release()
    }
  })

  test(`${dataset} export wait can be cancelled and retried`, async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    await page.route(
      `**/api/research/export?dataset=${dataset}&format=bundle`,
      async (route) => {
        calls++
        if (calls > 1) return route.fallback()
        await held
        await route.abort()
      },
    )
    const downloads: string[] = []
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    )
    try {
      const button = page.getByRole("button", { name, exact: true })
      await button.click()
      await expect.poll(() => calls).toBe(1)
      const cancelled = page.waitForEvent("requestfailed", (request) =>
        request.url().includes(`dataset=${dataset}&format=bundle`),
      )
      await page
        .getByRole("button", { name: `${name}の待機を中止`, exact: true })
        .click()
      await cancelled
      await expect(button).toBeEnabled()
      await expect(button).toBeFocused()
      await expect(
        page.getByRole("status").filter({ hasText: "取得待機を中止しました" }),
      ).toBeVisible()
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
      expect(downloads).toEqual([])

      const downloading = page.waitForEvent("download")
      await button.click()
      const download = await downloading
      expect(await download.failure()).toBeNull()
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${dataset}-source-[a-f0-9-]+\\.zip$`),
      )
      expect(calls).toBe(2)
      expect(downloads).toHaveLength(1)
    } finally {
      release()
    }
  })
}

for (const outcome of ["success", "failure"] as const) {
  test(`a cancelled body read with late ${outcome} cannot interfere with retry`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      const testWindow = window as ExportTestWindow
      testWindow.heldExports = []
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        )
        if (
          url.pathname !== "/api/research/export" ||
          url.searchParams.get("dataset") !== "research" ||
          testWindow.heldExports.length >= 2
        )
          return originalFetch(input, init)
        const held: HeldExport = {
          controller: null,
          signal: init?.signal ?? null,
          reading: false,
          settled: false,
        }
        testWindow.heldExports.push(held)
        // Deliberately retain a body that ignores abort to exercise late settlement.
        const response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              held.controller = controller
              controller.enqueue(new TextEncoder().encode("synthetic ZIP"))
            },
          }),
          {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition":
                'attachment; filename="research-source-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.zip"',
            },
          },
        )
        const readBlob = response.blob.bind(response)
        response.blob = async () => {
          held.reading = true
          try {
            return await readBlob()
          } finally {
            held.settled = true
          }
        }
        return Promise.resolve(response)
      }
    })
    const downloads: string[] = []
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    )
    const button = page.getByRole("button", {
      name: "研究用データを保存（ZIP）",
      exact: true,
    })
    const cancel = page.getByRole("button", {
      name: "研究用データを保存（ZIP）の待機を中止",
      exact: true,
    })
    await button.click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ExportTestWindow).heldExports[0]?.reading,
        ),
      )
      .toBe(true)
    await cancel.click()
    await expect(button).toBeEnabled()
    await button.click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ExportTestWindow).heldExports[1]?.reading,
        ),
      )
      .toBe(true)
    await page.evaluate((lateOutcome) => {
      const held = (window as ExportTestWindow).heldExports[0]
      if (lateOutcome === "success") held.controller?.close()
      else held.controller?.error(new Error("Synthetic late body failure"))
    }, outcome)
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ExportTestWindow).heldExports[0].settled,
        ),
      )
      .toBe(true)
    await expect(
      page.getByRole("button", { name: "ZIPを準備しています…", exact: true }),
    ).toBeDisabled()
    await expect(cancel).toBeVisible()
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    expect(downloads).toEqual([])
    await expect(
      page.getByRole("button", {
        name: "参加管理・アクセスデータを保存（ZIP）",
        exact: true,
      }),
    ).toBeEnabled()

    // The old request's finally must not detach the new request's controller.
    await cancel.click()
    await expect(button).toBeEnabled()
    await expect(button).toBeFocused()
    expect(
      await page.evaluate(() =>
        (window as ExportTestWindow).heldExports.map(
          (held) => held.signal?.aborted,
        ),
      ),
    ).toEqual([true, true])
    await page.evaluate(() => {
      ;(window as ExportTestWindow).heldExports[1].controller?.close()
    })
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ExportTestWindow).heldExports[1].settled,
        ),
      )
      .toBe(true)
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    expect(downloads).toEqual([])
    const downloading = page.waitForEvent("download")
    await button.click()
    const download = await downloading
    expect(await download.failure()).toBeNull()
    expect(downloads).toHaveLength(1)
  })
}

test("an unexpected HTML response never becomes a downloaded archive", async ({
  page,
}) => {
  await page.route(
    "**/api/research/export?dataset=research&format=bundle",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>synthetic-login-response</body></html>",
      }),
  )
  const downloads: string[] = []
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  )
  await page
    .getByRole("button", { name: "研究用データを保存（ZIP）", exact: true })
    .click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "出力は完了していません",
  )
  await expect(page.getByText("synthetic-login-response")).toHaveCount(0)
  await expect(page).toHaveURL(/\/research$/)
  expect(downloads).toEqual([])
})

test("leaving the export page cancels its request without a late download", async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route(
    "**/api/research/export?dataset=research&format=bundle",
    async (route) => {
      requested = true
      await held
      await route.abort()
    },
  )
  const downloads: string[] = []
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  )
  try {
    await page
      .getByRole("button", { name: "研究用データを保存（ZIP）", exact: true })
      .click()
    await expect.poll(() => requested).toBe(true)
    const cancelled = page.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/research/export?"),
    )
    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "参加者", exact: true })
      .click()
    await expect(page).toHaveURL(/\/participant$/)
    await cancelled
    release()
    await page.goBack()
    await expect(
      page.getByRole("button", {
        name: "研究用データを保存（ZIP）",
        exact: true,
      }),
    ).toBeEnabled()
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    await expect(page.getByText(/ダウンロードを開始しました/)).toHaveCount(0)
    expect(downloads).toEqual([])
  } finally {
    release()
  }
})

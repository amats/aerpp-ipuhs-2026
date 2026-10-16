import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"
import { createSupportApp } from "../src/app.js"
import { MailSink } from "../src/mail.js"
import { syntheticRuntime } from "../test-support/runtime.js"

let server: Server
let origin: string
test.beforeAll(async () => {
  const app = createSupportApp(
    syntheticRuntime(),
    {} as Firestore,
    new MailSink(),
  )
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
test("public pages load local styles with no overflow in light and dark themes", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of [
        "/",
        "/privacy",
        "/terms",
        "/contact",
        "/email/confirm",
      ]) {
        await page.goto(origin + path)
        await expect(page.locator("h1")).toBeVisible()
        await expect(page.locator("body")).not.toContainText("移行検証")
        if (path === "/email/confirm") {
          const bounds = await page.locator(".card").boundingBox()
          expect(bounds?.width).toBeLessThanOrEqual(480)
        }
        expect(
          await page
            .locator(".card")
            .evaluate((element) => getComputedStyle(element).borderRadius),
        ).toBe("20px")
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
      }
    }
  }
  expect(errors).toEqual([])
})
test("confirmation requires a click and exposes pending, retry and completion states", async ({
  page,
}) => {
  let requests = 0
  const pending: { finish?: () => void } = {}
  const release = () => {
    pending.finish?.()
    delete pending.finish
  }
  await page.route("**/email/confirm", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    requests++
    await new Promise<void>((resolve) => {
      pending.finish = resolve
    })
    await route.fulfill({
      status: requests === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        requests === 1 ? { code: "UNAVAILABLE" } : { ok: true },
      ),
    })
  })
  await page.goto(
    `${origin}/email/confirm#consentId=AbCdEfGhIjKlMnOpQrSt&token=${"a".repeat(43)}`,
  )
  await expect(page).toHaveURL(`${origin}/email/confirm`)
  expect(requests).toBe(0)
  const button = page.getByRole("button")
  await button.click()
  await expect(button).toHaveText("確認しています…")
  await expect(button).toBeDisabled()
  await expect.poll(() => Boolean(pending.finish)).toBe(true)
  release()
  await expect(page.getByRole("status")).toContainText(
    "時間をおいて、もう一度確認ボタンを押してください",
  )
  await expect(button).toBeEnabled()
  await button.click()
  await expect.poll(() => Boolean(pending.finish)).toBe(true)
  release()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  await expect(button).toHaveText("確認完了")
  await expect(button).toBeDisabled()
  await page.goto(`${origin}/email/confirm`)
  await expect(page.getByRole("status")).toContainText("確認リンクが無効")
  await expect(button).toBeDisabled()
})

test("expired confirmation stops retrying and a new link restores the form after reception closes", async ({
  page,
}) => {
  let code = "AUTHENTICATION_EXPIRED"
  let requests = 0
  await page.route("**/email/confirm", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    requests++
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code }),
    })
  })
  const fragment = `#consentId=AbCdEfGhIjKlMnOpQrSt&token=${"a".repeat(43)}`
  await page.goto(`${origin}/email/confirm${fragment}`)
  await page.getByRole("button").click()
  await expect(page.getByRole("status")).toContainText("有効期限が切れています")
  await expect(page.getByRole("status")).toContainText(
    "同意とメール認証をやり直してください",
  )
  await expect(page.getByRole("button")).toBeDisabled()
  expect(requests).toBe(1)

  code = "RECEPTION_CLOSED"
  await page.evaluate((hash) => {
    location.hash = hash
  }, fragment)
  await page.getByRole("button").click()
  await expect(page.getByRole("status")).toContainText("受付は終了しました")
  await expect(page.getByRole("button")).toHaveCount(0)

  code = "AUTHENTICATION_USED"
  await page.evaluate((hash) => {
    location.hash = hash
  }, fragment)
  await page.getByRole("button").click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  await expect(page.getByRole("status")).toContainText("「次に進む」")
  await expect(page.getByRole("button")).toBeDisabled()
})

test("rate-limited confirmation waits before manual retry and fences an old timer on a new link", async ({
  page,
}) => {
  let requests = 0
  let delay = "3"
  await page.clock.install()
  await page.route("**/email/confirm", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    requests++
    await route.fulfill({
      status: requests === 2 ? 200 : 429,
      contentType: "application/json",
      headers: { "Retry-After": delay },
      body: JSON.stringify(
        requests === 2 ? { ok: true } : { code: "RATE_LIMITED" },
      ),
    })
  })
  const fragment = `#consentId=AbCdEfGhIjKlMnOpQrSt&token=${"a".repeat(43)}`
  await page.goto(`${origin}/email/confirm${fragment}`)
  const button = page.getByRole("button")
  await button.click()
  await expect(page.getByRole("status")).toContainText("3秒後")
  await expect(button).toBeDisabled()
  await page.clock.fastForward(2000)
  await expect(button).toBeDisabled()
  expect(requests).toBe(1)
  await page.clock.fastForward(1000)
  await expect(button).toBeEnabled()
  expect(requests).toBe(1)
  await button.click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")

  await page.evaluate((hash) => {
    location.hash = hash
  }, fragment)
  delay = "300"
  await button.click()
  await expect(page.getByRole("status")).toContainText("300秒後")
  await page.evaluate(() => {
    location.hash = "#invalid"
  })
  await expect(page.getByRole("status")).toContainText("確認リンクが無効")
  await page.clock.fastForward(300000)
  await expect(button).toBeDisabled()
  expect(requests).toBe(3)
})

test("confirmation timeout retains the same link for explicit retry without an automatic second request", async ({
  page,
}) => {
  await page.clock.install()
  // Drive native timeout semantics through the browser's synthetic test clock.
  await page.addInitScript(() => {
    AbortSignal.timeout = (milliseconds: number) => {
      const controller = new AbortController()
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      )
      return controller.signal
    }
  })
  const bodies: unknown[] = []
  await page.route("**/email/confirm", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) return
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    })
  })
  await page.goto(
    `${origin}/email/confirm#consentId=AbCdEfGhIjKlMnOpQrSt&token=${"a".repeat(43)}`,
  )
  const button = page.getByRole("button")
  await button.click()
  await expect.poll(() => bodies.length).toBe(1)
  await page.clock.fastForward(15_000)
  await expect(page.getByRole("status")).toContainText(
    "受付結果の確認に時間がかかっています",
  )
  await expect(button).toBeDisabled()
  await page.clock.fastForward(15_000)
  await expect(page.getByRole("status")).toContainText("同じ確認ボタンを押して")
  await expect(button).toBeEnabled()
  expect(bodies).toHaveLength(1)
  await button.click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
})

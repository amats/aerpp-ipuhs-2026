import { test as base, expect, type Page } from "@playwright/test"
import survey from "../../../../config/common/survey/survey-initial.json"
import { readBrowserScope } from "./browser-state"
import { APP_URL, DOCUMENT_TEXT, STUB_URL } from "./constants.mjs"
import { installSessionTokenCapture } from "./session-token-capture"

export async function currentSessionToken(page: Page) {
  let token: string | undefined
  await expect
    .poll(async () => {
      const snapshot = await page.evaluate(() => ({
        token: (window as Window & { __aerppTestSessionToken?: string })
          .__aerppTestSessionToken,
      }))
      token = snapshot.token
      return (
        typeof token === "string" &&
        token.split(":")[0] === (await readBrowserScope(page))
      )
    })
    .toBe(true)
  return token as string
}

type StubState = {
  calls: Record<string, number>
  violations: string[]
  surveyHashes: string[]
  consentHashes: string[]
  consentIds: string[]
  analysisPromptHashes: string[]
  analysisAttempts: {
    analysisId: string
    outcome: string
    documentGraphemeCounts?: number[]
    consentId: string
  }[]
  analysisAuditOutcomes: {
    analysisId: string
    outcome: string
    endedAtMs: number
  }[]
  sawDocument: boolean
  withdrawalHashes: string[]
  abortedAnalyses: number
}

type LocalServices = {
  scenario: (value: {
    recovery?: {
      recoveryId: string
      destination: "initial-document" | "initial-survey" | "follow-up-document"
      analysisId?: string
    }
    recoveryConsumed?: boolean
    initialSurveyAcceptedBeforeAnalysis?: boolean
    currentWithdrawalId?: string
    failSurveyOnce?: boolean
    failConsentOnce?: boolean
    failReadiness?: boolean
    failAnalysis?: boolean
    failFailureRecord?: boolean
    analysisText?: string
    failTerminal?: boolean
    failMetadata?: boolean
    failPresentation?: boolean
    failCancellation?: boolean
    failAuthentication?: boolean
    holdAuthentication?: boolean
    authenticationDelayMs?: number
    holdAnalysis?: boolean
    holdSurvey?: boolean
    holdWithdrawal?: boolean
    withdrawalDelayMs?: number
    withdrawalFailure?: "pending" | "failed"
    documentHistory?: "multiple" | "different" | "same-version"
    failDocumentHistory?: boolean
  }) => Promise<void>
  release: () => Promise<void>
  restartWeb: () => Promise<void>
  state: () => Promise<StubState>
}

export const test = base.extend<{ localServices: LocalServices }>({
  localServices: [
    async ({ context, request }, use) => {
      const pageErrors: string[] = []
      const externalRequests: string[] = []
      await context.addInitScript(installSessionTokenCapture)
      context.on("page", (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message))
      })
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.origin === APP_URL) return route.continue()
        externalRequests.push(url.origin)
        await route.abort()
      })
      async function post(path: string, data = {}) {
        const response = await request.post(`${STUB_URL}/__test/${path}`, {
          data,
        })
        expect(response.ok()).toBe(true)
      }
      async function state(): Promise<StubState> {
        const response = await request.get(`${STUB_URL}/__test/state`)
        expect(response.ok()).toBe(true)
        return response.json()
      }
      await post("reset")
      try {
        await use({
          scenario: (data) => post("scenario", data),
          release: () => post("release"),
          restartWeb: () => post("restart-web"),
          state,
        })
      } finally {
        await post("release")
        expect((await state()).violations).toEqual([])
        expect(externalRequests).toEqual([])
        expect(pageErrors).toEqual([])
      }
    },
    { auto: true },
  ],
})

export { expect } from "@playwright/test"

type NavigationOptions = { navigate?: boolean }

export async function openConsent(page: Page, options: NavigationOptions = {}) {
  if (options.navigate !== false) await page.goto("/")
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await page.getByRole("button", { name: "同意画面へ進む" }).click()
  await expect(
    page.getByRole("heading", { name: "承諾書", exact: true }),
  ).toBeVisible()
}

export async function sendConsent(page: Page, options: NavigationOptions = {}) {
  await openConsent(page, options)
  const checks = page.getByRole("checkbox")
  expect(await checks.count()).toBeGreaterThan(0)
  for (const checkbox of await checks.all()) await checkbox.check()
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "メールアドレス認証を行う" }),
  ).toBeVisible()
}

export async function openDocuments(
  page: Page,
  options: NavigationOptions = {},
) {
  await sendConsent(page, options)
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "倫理申請書類の解析を準備する" }),
  ).toBeVisible()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("AERPP-Consent.pdf")
  expect(await download.failure()).toBeNull()
}

export async function fillSurvey(page: Page) {
  for (const item of survey.items) {
    if (item.type === "section" || !item.item_id) continue
    const controls = page.locator(`[name="${item.item_id}"]`)
    if (item.type === "text") await controls.fill("架空の回答です。")
    else if (item.type === "single_choice")
      await controls.selectOption({ index: 1 })
    else await controls.first().check()
  }
}

export function documentInput(page: Page) {
  return page.locator('textarea[name="document-content"]:visible')
}

export async function analyzeDocument(
  page: Page,
  options: NavigationOptions = {},
) {
  await openDocuments(page, options)
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
}

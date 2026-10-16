import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { surveyJsonSchema } from "../src/features/survey/survey-json-types"
import { DOCUMENT_TEXT } from "../test-support/e2e/constants.mjs"
import { documentInput, expect, test } from "../test-support/e2e/fixtures"

test("capture desktop participation screens", async ({
  page,
  browser,
  localServices,
}) => {
  const outputDirectory = process.env.AERPP_SCREENSHOT_DIR ?? ""
  if (!outputDirectory) throw new Error("Run pnpm run screenshots")
  const screens: { file: string; title: string; route: string }[] = []
  const startedAt = new Date().toISOString()

  async function capture(name: string, title: string, heading: string) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur()
      window.scrollTo(0, 0)
    })
    await page.mouse.move(0, 0)
    const file = `${String(screens.length + 1).padStart(2, "0")}-${name}.png`
    await page.screenshot({
      path: path.join(outputDirectory, file),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      style:
        'body { font-family: "Helvetica Neue", Arial, "Noto Sans CJK JP", sans-serif; }',
    })
    screens.push({ file, title, route: new URL(page.url()).pathname })
  }

  async function survey(kind: "initial" | "follow-up") {
    const data = surveyJsonSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            `../../config/common/survey/survey-${kind}.json`,
          ),
          "utf8",
        ),
      ),
    )
    await expect(
      page.getByRole("heading", { name: "アンケートの回答と送信" }),
    ).toBeVisible()
    for (const item of data.items) {
      if (item.type === "section") continue
      const controls = page.locator(`[name=${JSON.stringify(item.item_id)}]`)
      await expect(controls.first()).toBeVisible()
    }
    await capture(
      `survey-${kind}`,
      kind === "initial" ? "初回アンケート" : "フォローアップアンケート",
      "アンケートの回答と送信",
    )
    for (const item of data.items) {
      if (item.type === "section") continue
      const controls = page.locator(`[name=${JSON.stringify(item.item_id)}]`)
      if (item.type === "text") await controls.fill("撮影用の架空の回答です。")
      else if (item.type === "single_choice")
        await controls.selectOption({ index: 1 })
      else await controls.first().check()
    }
    await page
      .getByRole("button", { name: "アンケートを送信", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "ご協力ありがとうございました" }),
    ).toBeVisible()
  }

  await page.goto("/")
  await capture("start", "案内", "このシステムについて")
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  await capture(
    "explanation",
    "研究の説明",
    "研究へのご参加について（研究の説明）",
  )
  await page.getByRole("button", { name: "同意画面へ進む" }).click()
  await capture("consent", "同意", "承諾書")
  const checks = page.getByRole("checkbox")
  expect(await checks.count()).toBeGreaterThan(0)
  for (const checkbox of await checks.all()) await checkbox.check()
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  await page.getByRole("button", { name: "同意する", exact: true }).click()
  await capture("authentication", "メール認証案内", "メールアドレス認証を行う")
  const consentDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "次に進む", exact: true }).click()
  expect(await (await consentDownload).failure()).toBeNull()
  await expect(documentInput(page)).toBeVisible()
  await capture("documents", "書類準備", "倫理申請書類の解析を準備する")
  await documentInput(page).fill(DOCUMENT_TEXT)
  await localServices.scenario({ holdAnalysis: true })
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(page.getByText("解析中です...", { exact: true })).toBeVisible()
  await capture("analyzing", "解析中", "解析結果")
  await localServices.release()
  await localServices.scenario({})
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await capture("result", "初回の解析結果", "解析結果")
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await survey("initial")
  await capture("thanks", "アンケート送信完了", "ご協力ありがとうございました")

  await page
    .getByRole("button", { name: "結果表示に戻る", exact: true })
    .click()
  await page
    .getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    })
    .click()
  await expect(documentInput(page)).toBeVisible()
  await documentInput(page).fill(DOCUMENT_TEXT)
  await page
    .getByRole("button", { name: "解析を開始する", exact: true })
    .click()
  await expect(
    page.getByText("解析が終了しました。", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: "ブラウザー内の一時データを消去する",
      exact: true,
    }),
  ).toBeVisible()
  await capture("follow-up-result", "継続利用の解析結果", "解析結果")
  await page
    .getByRole("button", { name: "アンケートを開く", exact: true })
    .click()
  await survey("follow-up")

  await page.goto("/download")
  await expect(
    page.getByRole("button", {
      name: "同意書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeEnabled()
  await expect(
    page.getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toHaveCount(0)
  await capture("downloads", "書類ダウンロード（参加中）", "同意履歴・関連書類")
  await page.goto("/withdraw")
  await capture("withdrawal", "同意撤回", "同意の撤回")
  await page
    .getByRole("textbox", { name: "メールアドレス", exact: true })
    .fill("participant@example.invalid")
  const withdrawalDownload = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "同意を撤回する", exact: true })
    .click()
  expect(await (await withdrawalDownload).failure()).toBeNull()
  await capture("withdrawn", "撤回完了", "研究参加の撤回を受け付けました")
  await expect(
    page.getByText("データの消去が完了しました", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("link", {
      name: "同意履歴・関連書類（同意撤回書の控え）",
      exact: true,
    })
    .click()
  await expect(
    page.getByRole("button", {
      name: "同意撤回書の控え：PDFをダウンロード",
      exact: true,
    }),
  ).toBeEnabled()
  await capture(
    "downloads-withdrawn",
    "書類ダウンロード（撤回後）",
    "同意履歴・関連書類",
  )

  const state = await localServices.state()
  expect(state.surveyHashes).toHaveLength(2)
  expect(state.calls["/v1/responses"]).toBe(2)
  expect(state.withdrawalHashes).toHaveLength(1)
  expect(screens).toHaveLength(15)
  await writeFile(
    path.join(outputDirectory, "manifest.json"),
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        browser: browser.version(),
        viewport: page.viewportSize(),
        colorScheme: "light",
        services:
          "local synthetic authentication, analysisQuestionnaires and LLM",
        screens,
      },
      null,
      2,
    ),
  )
  const cards = screens
    .map(
      ({ file, title, route }) =>
        `<section><h2>${title}</h2><p>${route} · <a href="${file}">${file}</a></p><a href="${file}"><img src="${file}" alt="${title}" loading="lazy"></a></section>`,
    )
    .join("\n")
  await writeFile(
    path.join(outputDirectory, "index.html"),
    `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AERPP PC画面一覧</title>
<style>body{font-family:system-ui,sans-serif;max-width:1440px;margin:auto;padding:24px;background:#f1f5f9;color:#0f172a}section{background:white;margin:24px 0;padding:20px;border-radius:12px}img{width:100%;height:auto;border:1px solid #cbd5e1}a{color:#075985}</style>
<h1>AERPP PC画面一覧</h1><p>assets / 1440 × 900 / ライトモード / ${startedAt}</p>
<p>案内・設問はassetsの内容です。認証・回答・入力書類・解析結果には撮影用の架空データを使用しています。</p>
${cards}</html>`,
  )
})

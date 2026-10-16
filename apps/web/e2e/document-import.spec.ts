import JSZip from "jszip"
import { createSparseOfficeFile } from "../test-support/document-import"
import {
  documentInput,
  expect,
  openDocuments,
  test,
} from "../test-support/e2e/fixtures"

async function pptx(repeated = false) {
  const zip = new JSZip()
  const count = repeated ? 200 : 1
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${i}" r:id="r1"/>`).join("")}</p:sldIdLst></p:presentation>`,
  )
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<Relationships><Relationship Id="r1" Type="urn:office/slide" Target="slides/1.xml"/></Relationships>',
  )
  zip.file(
    "ppt/slides/1.xml",
    `<root><p><t>${repeated ? "x".repeat(1000) : "Normal slide text"}</t></p></root>`,
  )
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

for (const kind of ["docx", "pptx"] as const) {
  test(`imports a 2 GB local ${kind} through bounded File reads`, async ({
    page,
    localServices,
  }) => {
    const text = "あ".repeat(29000)
    const fixture = await createSparseOfficeFile(kind, 2_000_000_000, text)
    try {
      await openDocuments(page)
      const callsBefore = (await localServices.state()).calls
      await page
        .getByLabel("解析する書類ファイルを選択")
        .setInputFiles(fixture.path)
      await expect(documentInput(page)).toHaveValue(text)
      expect((await localServices.state()).calls).toEqual(callsBefore)
    } finally {
      await fixture.dispose()
    }
  })
}

test("real Workers import DOCX/PPTX locally and preserve the draft after unsafe input", async ({
  page,
  localServices,
}) => {
  await openDocuments(page)
  const callsBefore = (await localServices.state()).calls
  const file = page.getByLabel("解析する書類ファイルを選択")
  await file.setInputFiles({
    name: "synthetic.pptx",
    mimeType: "application/octet-stream",
    buffer: await pptx(),
  })
  await expect(documentInput(page)).toHaveValue("Normal slide text")
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "本文をクリア", exact: true }).click()
  const docx = new JSZip()
  docx.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Normal Word text</w:t></w:r></w:p></w:body></w:document>',
  )
  await file.setInputFiles({
    name: "synthetic.docx",
    mimeType: "application/octet-stream",
    buffer: await docx.generateAsync({ type: "nodebuffer" }),
  })
  await expect(documentInput(page)).toHaveValue("Normal Word text")
  await page.getByRole("button", { name: "+ 書類を追加", exact: true }).click()
  await file.setInputFiles({
    name: "repeated.pptx",
    mimeType: "application/octet-stream",
    buffer: await pptx(true),
  })
  await expect(
    page
      .getByRole("region", { name: "ファイル読み込みエリア" })
      .getByText(
        "ファイルを読み込めませんでした。形式・サイズ・本文の長さを確認してください。端末内で本文をテキストファイルに保存して読み込む方法もあります。",
      ),
  ).toBeVisible()
  await expect(documentInput(page)).toHaveValue("")
  await expect(file).toBeEnabled()
  await page.getByRole("tab", { name: /^synthetic.docx/ }).click()
  await expect(documentInput(page)).toHaveValue("Normal Word text")
  // File import has no participant API or local-model requests.
  expect((await localServices.state()).calls).toEqual(callsBefore)
})

test("cancellation terminates a real Worker and allows the next import", async ({
  page,
}) => {
  // Hold only the first Worker's input, keeping its native lifecycle intact.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let first = true
    window.Worker = class extends NativeWorker {
      constructor(url: URL | string, options?: WorkerOptions) {
        super(url, options)
        if (first === true) {
          first = false
          this.postMessage = () => {}
        }
      }
    }
  })
  await openDocuments(page)
  await documentInput(page).fill("Preserved draft")
  await page.getByRole("button", { name: "+ 書類を追加", exact: true }).click()
  const file = page.getByLabel("解析する書類ファイルを選択")
  await file.setInputFiles({
    name: "cancel.pptx",
    mimeType: "application/octet-stream",
    buffer: await pptx(),
  })
  await page
    .getByRole("button", { name: "読み込みを中止", exact: true })
    .click()
  await expect(documentInput(page)).toHaveValue("")
  await expect(file).toBeEnabled()
  await file.setInputFiles({
    name: "retry.pptx",
    mimeType: "application/octet-stream",
    buffer: await pptx(),
  })
  await expect(documentInput(page)).toHaveValue("Normal slide text")
})

test("root-level renamed DOCX parts receive XML validation and normal parts remain readable", async ({
  page,
}) => {
  await openDocuments(page)
  const zip = new JSZip()
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="main.dat"/></Relationships>',
  )
  zip.file(
    "_rels/main.dat.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.data"/></Relationships>',
  )
  zip.file(
    "main.dat",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Root document text</w:t></w:r></w:p></w:body></w:document>',
  )
  const file = page.getByLabel("解析する書類ファイルを選択")
  const input = async () => ({
    name: "root-parts.docx",
    mimeType: "application/octet-stream",
    buffer: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
  })
  zip.file("styles.data", "<a>".repeat(70) + "</a>".repeat(70))
  await file.setInputFiles(await input())
  await expect(
    page
      .getByRole("region", { name: "ファイル読み込みエリア" })
      .getByRole("alert"),
  ).toContainText("ファイルを読み込めませんでした")
  await expect(documentInput(page)).toHaveValue("")
  zip.file(
    "styles.data",
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
  )
  await file.setInputFiles(await input())
  await expect(documentInput(page)).toHaveValue("Root document text")
})

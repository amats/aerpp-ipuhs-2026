import DOMPurify from "dompurify"
import saveAs from "file-saver"
import { asBlob } from "html-docx-js-typescript"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { remarkImagesToText } from "./remark-images-to-text"
import { remarkResultWhitespace } from "./remark-result-whitespace"

// Convert Markdown into HTML that preserves basic table styling in Word.
async function convertMarkdownToHtmlForWord(markdown: string) {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkImagesToText)
    .use(remarkResultWhitespace)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)
  let html = DOMPurify.sanitize(result.toString())
  // Apply inline table styles because Word import ignores many external styles.
  html = html.replace(
    /<table>/g,
    '<table border="1" style="border-collapse: collapse; width: 100%;">',
  )
  html = html.replace(/<td>/g, '<td style="padding: 5px;">')
  html = html.replace(
    /<th>/g,
    '<th style="padding: 5px; background-color: #f2f2f2;">',
  )
  // Use a Japanese-capable default font to reduce character fallback issues in Word.
  return `<div style="font-family: 'MS PGothic', sans-serif; font-size: 11pt; line-height: 1.5;">${html}</div>`
}

export async function downloadAnalysisResultAsWord(resultText: string) {
  const htmlContent = await convertMarkdownToHtmlForWord(resultText)
  const fullHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`
  const blob = (await asBlob(fullHtml)) as Blob
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const dateString = `${year}${month}${day}`
  saveAs(blob, `AERPP-${dateString}.docx`)
}

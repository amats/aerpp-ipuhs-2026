import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import { researchAssetsDirectory } from "../src/lib/research-assets.mjs"

const text = fs.readFileSync(
  path.join(
    researchAssetsDirectory(fileURLToPath(new URL("../", import.meta.url))),
    "consent.mdx",
  ),
  "utf8",
)
const element = React.createElement(ReactMarkdown, {}, text)
const html = renderToStaticMarkup(element)
console.log(html)

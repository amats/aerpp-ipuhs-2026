import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { findMarkdownLinkViolations } from "./markdown-links.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

function workspace(t) {
  return createWorkspace(t, "aerpp-markdown-links-")
}

test("detects a removed heading, including same-file fragments", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    "# Guide\n[Gone](#removed)\n[Section](docs/setup.md#removed)\n",
  )
  write("docs/setup.md", "## Present\n")
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [
      "README.md: missing heading anchor (#removed)",
      "README.md: missing heading anchor (docs/setup.md#removed)",
    ],
  )
})

test("handles duplicate headings, inline formatting and Japanese anchors", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    "## `Run` and **check**\n## Run and check\n## 設定\n[First](#run-and-check) [Second](#run-and-check-1) [Japanese](#%E8%A8%AD%E5%AE%9A)\n",
  )
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [],
  )
})

test("checks reference definitions and paths containing spaces", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    "[Guide][setup]\n[setup]: <docs/my guide.md#setup>\n[Encoded](docs/my%20guide.md#setup)\n",
  )
  write("docs/my guide.md", "# Setup\n")
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [],
  )
  rmSync(path.join(root, "docs/my guide.md"))
  assert.equal(
    findMarkdownLinkViolations(root, path.join(root, "README.md")).length,
    2,
  )
})

test("ignores code examples, remote URLs and application routes", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    "[External](https://example.com/no-check) [App](/reset)\n```md\n[Example](missing.md)\n# Fake\n```\n~~~\n[Another](missing.md)\n~~~\n",
  )
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [],
  )
})

test("fenced headings do not satisfy real anchors", (t) => {
  const { root, write } = workspace(t)
  write("README.md", "```md\n# Fake\n```\n[Fake](#fake)\n")
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    ["README.md: missing heading anchor (#fake)"],
  )
})

test("ignores links and anchors in inline code and HTML comments", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    [
      "`[Example](missing.md)` and ``[Another](missing.md) `code` ``",
      "<!-- [Retired](old.md)",
      "## Hidden",
      "-->",
      '`<a id="fake"></a>`',
      "[Hidden](#hidden) [Fake](#fake)",
    ].join("\n"),
  )
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [
      "README.md: missing heading anchor (#hidden)",
      "README.md: missing heading anchor (#fake)",
    ],
  )
})

test("does not close a code fence on a line with trailing text", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    "```md\n```example\n[Example](missing.md)\n## Hidden\n```\n[Hidden](#hidden)\n",
  )
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    ["README.md: missing heading anchor (#hidden)"],
  )
})

test("literal comment and fence delimiters cannot hide real links", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    [
      "`<!--` [Missing](missing.md)",
      "<!--",
      "```md",
      "-->",
      "## Visible",
      "~~~md",
      "<!--",
      "~~~",
      "[Visible](#visible) [Gone](#gone)",
    ].join("\n"),
  )
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    [
      "README.md: missing link target (missing.md)",
      "README.md: missing heading anchor (#gone)",
    ],
  )
})

test("accepts source links and explicit IDs; reports malformed encoding", (t) => {
  const { root, write } = workspace(t)
  write(
    "README.md",
    '<a id="manual-anchor"></a>\n[Anchor](#manual-anchor) [Source](scripts/helper.mjs) [Broken](docs/%ZZ.md)\n',
  )
  write("scripts/helper.mjs", "")
  assert.deepEqual(
    findMarkdownLinkViolations(root, path.join(root, "README.md")),
    ["README.md: malformed local link (docs/%ZZ.md)"],
  )
})

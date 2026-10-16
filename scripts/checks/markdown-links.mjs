import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

function prose(source) {
  const openings =
    /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\2(?!`)|<!--/gm
  const parts = []
  let cursor = 0
  let match = openings.exec(source)
  while (match !== null) {
    if (match[2] !== undefined) {
      match = openings.exec(source)
      continue
    }
    parts.push(source.slice(cursor, match.index))
    let end = source.length
    if (match[1] === undefined) {
      const closing = source.indexOf("-->", openings.lastIndex)
      if (closing >= 0) end = closing + 3
    } else {
      const closing = new RegExp(
        `^ {0,3}${match[1][0]}{${match[1].length},}[ \\t]*\\r?$`,
        "gm",
      )
      closing.lastIndex = openings.lastIndex
      const found = closing.exec(source)
      if (found !== null) end = closing.lastIndex
    }
    // Preserve line boundaries so hidden examples cannot join real headings.
    parts.push(source.slice(match.index, end).replace(/[^\n]/g, ""))
    cursor = end
    openings.lastIndex = end
    match = openings.exec(source)
  }
  parts.push(source.slice(cursor))
  return parts.join("")
}

function withoutInlineCode(source) {
  return source.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, (span) =>
    span.replace(/[^\n]/g, " "),
  )
}

function headingAnchors(source) {
  const anchors = new Set()
  for (const match of source.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
      .replace(/ /g, "-")
    let anchor = slug
    let suffix = 0
    while (anchors.has(anchor) === true) anchor = `${slug}-${++suffix}`
    anchors.add(anchor)
  }
  for (const match of withoutInlineCode(source).matchAll(
    /\b(?:id|name)=["']([^"']+)["']/g,
  ))
    anchors.add(match[1])
  return anchors
}

function linkTargets(source) {
  const visible = withoutInlineCode(source)
  const inline = [
    ...visible.matchAll(
      /!?\[[^\n]*?\]\((<[^>\n]+>|[^\s\n)]+)(?:\s+["'][^\n]*["'])?\)/g,
    ),
  ]
  const definitions = [
    ...visible.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm),
  ]
  return [...inline, ...definitions].map((match) =>
    match[1].replace(/^<|>$/g, ""),
  )
}

export function findMarkdownLinkViolations(root, file, anchors = new Map()) {
  const violations = []
  const source = prose(readFileSync(file, "utf8"))
  for (const target of linkTargets(source)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target) === true) continue
    const hash = target.indexOf("#")
    const filePart = hash < 0 ? target : target.slice(0, hash)
    const fragment = hash < 0 ? "" : target.slice(hash + 1)
    let destination
    let anchor
    try {
      destination = filePart
        ? path.resolve(path.dirname(file), decodeURIComponent(filePart))
        : file
      anchor = decodeURIComponent(fragment)
    } catch {
      violations.push(
        `${path.relative(root, file)}: malformed local link (${target})`,
      )
      continue
    }
    if (existsSync(destination) !== true) {
      violations.push(
        `${path.relative(root, file)}: missing link target (${target})`,
      )
      continue
    }
    if (anchor.length === 0 || destination.endsWith(".md") !== true) continue
    if (anchors.has(destination) !== true)
      anchors.set(
        destination,
        headingAnchors(prose(readFileSync(destination, "utf8"))),
      )
    if (anchors.get(destination).has(anchor) !== true)
      violations.push(
        `${path.relative(root, file)}: missing heading anchor (${target})`,
      )
  }
  return violations
}

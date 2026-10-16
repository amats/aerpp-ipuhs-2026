const TOKEN = String.raw`(?:"[^"\n]+"|'[^'\n]+'|[^\s\x60;&|()]+)`
const OPTIONS = String.raw`(?:(?:--workspace-root|-w|--fail-if-no-match)\s+|--filter(?:=|\s+)${TOKEN}\s+)*`
const COMMAND = new RegExp(
  String.raw`\bpnpm\s+(${OPTIONS})(?:run\s+(${TOKEN})|(test|start)(?=[\s\x60;&|()]|$))`,
  "g",
)

function unquote(value) {
  return value.replace(/^["']|["']$/g, "")
}

export function findPnpmScriptViolations(source, manifests, defaultDirectory) {
  const violations = []
  for (const match of source.replace(/\\\r?\n/g, " ").matchAll(COMMAND)) {
    const filter = match[1].match(
      new RegExp(String.raw`--filter(?:=|\s+)(${TOKEN})`),
    )
    const packageName = filter ? unquote(filter[1]) : undefined
    const script = unquote(match[2] ?? match[3]).replace(/[.,]$/, "")
    // Placeholders and dynamic shell expressions are examples, not literal targets.
    if (/[<>${}*]/.test(`${packageName ?? ""} ${script}`)) continue
    const workspaceRoot = /(?:^|\s)(?:--workspace-root|-w)(?:\s|$)/.test(
      match[1],
    )
    const selected = packageName
      ? manifests.find((manifest) => manifest.name === packageName)
      : manifests.find(
          (manifest) =>
            manifest.directory ===
            (workspaceRoot ? manifests[0].directory : defaultDirectory),
        )
    if (!selected) violations.push(`unknown workspace package (${packageName})`)
    else if (!Object.hasOwn(selected.scripts, script))
      violations.push(
        `unknown pnpm script (${packageName ? `${packageName}: ` : ""}${script})`,
      )
  }
  return violations
}

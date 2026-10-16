import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readWorkspaceManifests } from "./workspace-manifests.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const TOKENS =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g

function sourceFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return SOURCE_EXTENSION.test(entry.name) ? [file] : []
  })
}

function readImports(source) {
  // Tokenize comments and strings together so examples inside either cannot
  // create fake imports. Computed module names remain a manual review concern.
  const tokens = [...source.matchAll(TOKENS)]
    .map(([value]) => value)
    .filter((value) => !value.startsWith("//") && !value.startsWith("/*"))
  const imports = []
  const add = (token) => {
    if (!token || !/^["'`]/.test(token) || token.includes("${")) return
    imports.push(
      token[0] === '"'
        ? JSON.parse(token)
        : token.slice(1, -1).replace(/\\(['`\\])/g, "$1"),
    )
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (
      !["import", "export", "require"].includes(token) ||
      tokens[index - 1] === "."
    )
      continue
    if (tokens[index + 1] === "(") {
      if ([")", ","].includes(tokens[index + 3])) add(tokens[index + 2])
      continue
    }
    if (token === "require") continue
    if (/^["']/.test(tokens[index + 1] ?? "")) {
      add(tokens[index + 1])
      continue
    }
    let bindingDepth = 0
    for (let next = index + 1; next < tokens.length; next++) {
      if (tokens[next] === "{") {
        bindingDepth++
        continue
      }
      if (tokens[next] === "}" && bindingDepth > 0) {
        bindingDepth--
        continue
      }
      if (bindingDepth > 0) continue
      if (tokens[next] === "as" && tokens[next - 1] === "*") {
        next++
        continue
      }
      if (
        (next === index + 1 && tokens[next] === "default") ||
        [
          ";",
          "import",
          "export",
          "const",
          "let",
          "function",
          "class",
          "=",
        ].includes(tokens[next])
      )
        break
      if (
        tokens[next] === "from" &&
        /^["']/.test(tokens[next + 1] ?? "") === true
      ) {
        add(tokens[next + 1])
        index = next + 1
        break
      }
    }
  }
  return imports
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target)
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export function findBoundaryViolations(root, selectedOwner) {
  const owners = readWorkspaceManifests(root).filter(
    (owner) => owner.directory !== root,
  )
  const selected =
    selectedOwner !== undefined
      ? owners.filter(
          (owner) => path.relative(root, owner.directory) === selectedOwner,
        )
      : owners
  if (selectedOwner !== undefined && selected.length === 0)
    return [`unknown source owner (${selectedOwner})`]
  const violations = []
  for (const owner of selected) {
    const sourceRoot = path.join(owner.directory, "src")
    const externalRoot = path.join(sourceRoot, "lib/external")
    for (const file of sourceFiles(sourceRoot)) {
      const area = path.relative(sourceRoot, file).split(path.sep)[0]
      const external = isWithin(externalRoot, file)
      for (const specifier of readImports(readFileSync(file, "utf8"))) {
        const target = specifier.startsWith("@/")
          ? path.resolve(sourceRoot, specifier.slice(2))
          : specifier.startsWith(".")
            ? path.resolve(path.dirname(file), specifier)
            : undefined
        const targetOwner =
          target !== undefined
            ? owners.find(
                (candidate) => isWithin(candidate.directory, target) === true,
              )
            : owners.find(
                (candidate) =>
                  specifier === candidate.name ||
                  specifier.startsWith(`${candidate.name}/`),
              )
        let message
        if (
          external === true &&
          (target !== undefined || targetOwner !== undefined) &&
          (target === undefined ||
            specifier.startsWith(".") !== true ||
            isWithin(externalRoot, target) !== true)
        ) {
          message = "external copies must not import repository code"
        }
        if (
          message === undefined &&
          targetOwner !== undefined &&
          targetOwner !== owner
        ) {
          if (isWithin(path.join(root, "apps"), targetOwner.directory) === true)
            message =
              "applications and packages must not import another application's code"
          else if (target !== undefined)
            message =
              "use the shared package's named exports instead of repository-relative imports"
          else {
            const subpath =
              specifier === targetOwner.name
                ? "."
                : `.${specifier.slice(targetOwner.name.length)}`
            if (!Object.hasOwn(targetOwner.exports ?? {}, subpath))
              message = "shared package subpath is not exported"
          }
        }
        if (
          message === undefined &&
          target !== undefined &&
          isWithin(sourceRoot, target) === true
        ) {
          const targetArea = path
            .relative(sourceRoot, target)
            .split(path.sep)[0]
          if (area === "lib" && ["app", "features", "ui"].includes(targetArea))
            message = "lib must not depend on application areas"
          if (area === "ui" && ["app", "features"].includes(targetArea))
            message = "ui must not depend on routes or feature orchestration"
        }
        if (message !== undefined)
          violations.push(
            `${path.relative(root, file)}: ${message} (${specifier})`,
          )
      }
    }
  }
  return violations
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = findBoundaryViolations(ROOT, process.argv[2])
  if (violations.length > 0) {
    console.error(["Source boundary check failed:", ...violations].join("\n"))
    process.exitCode = 1
  } else {
    console.log("Workspace source import boundaries passed.")
  }
}

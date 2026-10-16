import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
// Diagnostic only: Next's bundled Babel is private API; recheck on upgrades.
const { transformSync } = require("next/dist/compiled/babel/core")
const reactCompiler = require("babel-plugin-react-compiler")
const repoRoot = path.resolve(import.meta.dirname, "..")
const sourceRoot = path.join(repoRoot, "src")
const files = readdirSync(sourceRoot, { recursive: true })
  .filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !file.endsWith(".d.ts") &&
      !file.includes(".test.") &&
      !file.startsWith(`lib${path.sep}external${path.sep}`),
  )
  .sort()
let compiledFunctions = 0
const skippedFunctions = new Set()

console.info(
  `React Compiler ${require("babel-plugin-react-compiler/package.json").version}: source diagnostic, not client-bundle coverage or a performance benchmark.`,
)

for (const file of files) {
  const filename = path.join(sourceRoot, file)
  const label = path.relative(repoRoot, filename)
  try {
    transformSync(readFileSync(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [
        [
          reactCompiler,
          {
            // Matches the current Next.js production Babel path / React 19.
            environment: { enableNameAnonymousFunctions: false },
            logger: {
              logEvent(_filename, event) {
                const location = `${label}:${event.fnLoc?.start.line ?? 1}`
                if (event.kind === "CompileSuccess") {
                  compiledFunctions += 1
                  console.info(
                    `Compiled ${location} ${event.fnName ?? "anonymous"}`,
                  )
                } else if (
                  event.kind === "CompileError" ||
                  event.kind === "CompileDiagnostic" ||
                  event.kind === "CompileSkip"
                ) {
                  skippedFunctions.add(location)
                  const detail = event.detail?.options ?? event.detail
                  console.info(
                    `${event.kind} ${location}: ${detail?.reason ?? event.reason ?? "unspecified diagnostic"}`,
                  )
                } else if (event.kind === "PipelineError") {
                  console.error(`Compiler pipeline failed at ${location}`)
                  process.exitCode = 1
                }
              },
            },
          },
        ],
      ],
    })
  } catch {
    console.error(
      `Unable to compile ${label}; recheck the diagnostic adapter and source syntax.`,
    )
    process.exitCode = 1
  }
}

console.info(
  `${compiledFunctions} compiled functions; ${skippedFunctions.size} functions with diagnostics. Known bailouts retain normal React behavior and do not fail this report.`,
)

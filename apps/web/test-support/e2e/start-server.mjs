import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { stageLicenseNotices } from "../../../../scripts/licenses/stage-license-notices.mjs"
import {
  APP_PORT,
  APP_URL,
  STUB_URL,
  TEST_SUPPORT_CREDENTIAL,
} from "./constants.mjs"
import { startStubServer } from "./stub-server.mjs"

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url))
const monorepoRoot = path.resolve(workspaceRoot, "../..")
let stagingDirectory
let appDirectory
let child
let stub
let stopping = false
let cleanupPromise
let pendingRestart
let restartEnabled = false

async function restartApplication() {
  if (
    stopping ||
    restartEnabled !== true ||
    pendingRestart ||
    !child ||
    child.exitCode !== null
  )
    throw new Error("Synthetic Web restart is unavailable")
  pendingRestart = Promise.withResolvers()
  const restarted = pendingRestart.promise
  // An abrupt exit must not fabricate cancellation or terminal acknowledgement.
  child.kill("SIGKILL")
  await restarted
}

async function runApplication(args, options) {
  restartEnabled = true
  while (!stopping) {
    child = spawn(process.execPath, args, options)
    const exited = once(child, "exit")
    if (pendingRestart) {
      const restart = pendingRestart
      try {
        const deadline = Date.now() + 20_000
        while (true) {
          if (Date.now() >= deadline || stopping)
            throw new Error("Synthetic Web restart did not become ready")
          const healthy = await fetch(`${APP_URL}/health`, {
            signal: AbortSignal.timeout(1_000),
          }).then(
            (response) => response.ok,
            () => false,
          )
          if (healthy === true) break
          await delay(50)
        }
        pendingRestart = undefined
        restart.resolve()
      } catch (error) {
        restart.reject(error)
        throw error
      }
    }
    const [code] = await exited
    if (!stopping && !pendingRestart)
      throw new Error(`Playwright application stopped (${code})`)
  }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  stopping = true
  cleanupPromise = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit")
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
      await exited
      clearTimeout(timer)
    }
    if (stub) {
      stub.closeAllConnections()
      await new Promise((resolve) => stub.close(resolve))
    }
    if (stagingDirectory)
      await rm(stagingDirectory, { recursive: true, force: true })
  })()
  return cleanupPromise
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void cleanup().then(() => process.exit(0)))
}

async function start() {
  stub = await startStubServer({ restartApplication })
  const stagingRoot = path.join(workspaceRoot, ".playwright")
  await mkdir(stagingRoot, { recursive: true })
  stagingDirectory = await mkdtemp(path.join(stagingRoot, "app-"))
  appDirectory = path.join(stagingDirectory, "apps/web")
  await mkdir(appDirectory, { recursive: true })
  await cp(
    path.join(monorepoRoot, "packages/documents/fonts"),
    path.join(stagingDirectory, "packages/documents/fonts"),
    { recursive: true },
  )
  await cp(
    path.join(monorepoRoot, "config/common/llm"),
    path.join(stagingDirectory, "config/common/llm"),
    { recursive: true },
  )
  await cp(
    path.join(monorepoRoot, "config/common/documents"),
    path.join(stagingDirectory, "config/common/documents"),
    { recursive: true },
  )
  await cp(
    path.join(monorepoRoot, "config/common/survey"),
    path.join(stagingDirectory, "config/common/survey"),
    { recursive: true },
  )
  stageLicenseNotices(monorepoRoot, "web")
  // Browser tests and publishable screenshots always use the public asset set.
  for (const name of [
    "src",
    "assets-public",
    "public",
    "package.json",
    "tsconfig.json",
    "types.d.ts",
    "mdx-components.tsx",
    "postcss.config.mjs",
    "generated/licenses",
  ]) {
    await cp(path.join(workspaceRoot, name), path.join(appDirectory, name), {
      recursive: true,
      filter: (source) =>
        (!source.startsWith(
          path.join(workspaceRoot, "assets-public") + path.sep,
        ) ||
          /\.(mdx|pdf)$/.test(source)) &&
        !/\.test\.tsx?$/.test(source) &&
        path.basename(source) !== ".DS_Store",
    })
  }
  await symlink(
    path.join(workspaceRoot, "node_modules"),
    path.join(appDirectory, "node_modules"),
    "dir",
  )
  const configUrl = pathToFileURL(
    path.join(workspaceRoot, "next.config.ts"),
  ).href
  await writeFile(
    path.join(appDirectory, "next.config.mjs"),
    `import config from ${JSON.stringify(configUrl)}\nexport default { ...config, turbopack: { ...config.turbopack, root: ${JSON.stringify(monorepoRoot)} } }\n`,
  )
  const modelPath = "../../config/common/llm/lms-medgemma.json"
  const model = JSON.parse(
    await readFile(path.join(appDirectory, modelPath), "utf8"),
  )
  // Preserve model, generation settings and prompts; redirect only the copied transport endpoint.
  await writeFile(
    path.join(appDirectory, modelPath),
    JSON.stringify({ ...model, baseUrl: `${STUB_URL}/v1` }),
  )

  const debug = process.argv.includes("--debug")
  const testEnv = applicationEnvironment({
    NODE_ENV: debug ? "development" : "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PARTICIPANT_API_SERVER_ID: "playwright-local",
    IDENTIFIER_HASH_SECRET: "playwright-synthetic-identifier-secret",
    // Isolate the bounded authority from earlier browser-suite runs.
    SESSION_SEAL_PASSWORD: `playwright-synthetic-session-key-${randomUUID()}`,
    AERPP_ENVIRONMENT: "example",
    SUPPORT_API_BASE_URL: STUB_URL,
    SUPPORT_API_CREDENTIAL: TEST_SUPPORT_CREDENTIAL,
    SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    SUPPORT_CONTACT_EMAIL: "support@example.invalid",
    LLM_PRESET_FILE: "lms-medgemma.json",
    SESSION_COOKIE_SECURE: "false",
    DEBUG_PAGES_ENABLED: debug ? "true" : "false",
    LOG_LEVEL: "silent",
    NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/^[^\\s@]+@example\\.invalid$/",
  })
  const nextBin = path.join(workspaceRoot, "node_modules/next/dist/bin/next")
  if (stopping) return
  if (debug) {
    child = spawn(
      process.execPath,
      [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(APP_PORT)],
      { cwd: appDirectory, env: testEnv, stdio: "inherit" },
    )
    const [code, signal] = await once(child, "exit")
    if (stopping !== true)
      throw new Error(
        `Playwright development server stopped (exit code: ${code}, signal: ${signal ?? "none"})`,
      )
    return
  }
  child = spawn(process.execPath, [nextBin, "build"], {
    cwd: appDirectory,
    env: testEnv,
    stdio: "inherit",
  })
  const [buildCode, buildSignal] = await once(child, "exit")
  if (stopping) return
  if (buildCode !== 0)
    throw new Error(
      `Playwright application build failed (exit code: ${buildCode}, signal: ${buildSignal ?? "none"})`,
    )
  const buildManifest = JSON.parse(
    await readFile(
      path.join(appDirectory, ".next/required-server-files.json"),
      "utf8",
    ),
  )
  const standaloneDirectory = path.join(
    appDirectory,
    ".next/standalone",
    path.relative(buildManifest.config.outputFileTracingRoot, appDirectory),
  )
  for (const name of [
    "public",
    ".next/static",
    "../../config/common/llm",
    "../../packages/documents/fonts",
    "generated/licenses",
  ]) {
    await cp(
      path.join(appDirectory, name),
      path.join(standaloneDirectory, name),
      { recursive: true },
    )
  }
  if (stopping) return
  await runApplication([path.join(standaloneDirectory, "server.js")], {
    cwd: standaloneDirectory,
    env: { ...testEnv, HOSTNAME: "127.0.0.1", PORT: String(APP_PORT) },
    stdio: "inherit",
  })
}

try {
  await start()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await cleanup()
}

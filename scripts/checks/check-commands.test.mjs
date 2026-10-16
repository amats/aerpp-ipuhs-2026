import assert from "node:assert/strict"
import test from "node:test"
import { findCommandViolations } from "./check-commands.mjs"
import { WORKSPACE_CHECKS } from "./check-workspace.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

function workspace(t) {
  const { root, write } = createWorkspace(t, "aerpp-commands-")
  write("package.json", {
    name: "aerpp",
    scripts: {
      verify: "node --test",
      "test:web": "pnpm --fail-if-no-match --filter @aerpp/web run test",
    },
  })
  write("apps/web/package.json", {
    name: "@aerpp/web",
    scripts: { test: "vitest run", verify: "pnpm test && pnpm -w run verify" },
  })
  return { root, write }
}

test("checks root commands in README, contributor guides and fenced examples", (t) => {
  const { root, write } = workspace(t)
  write("README.md", "Run `pnpm run verify`.\n")
  write(
    "apps/web/CONTRIBUTING.md",
    "From the workspace root: `pnpm run test:web`.\n",
  )
  write("docs/development.md", "```sh\npnpm run removed\n```\n")
  assert.deepEqual(findCommandViolations(root), [
    "docs/development.md: unknown pnpm script (removed)",
  ])
})

test("rejects unfiltered app-only commands in app documentation", (t) => {
  const { root, write } = workspace(t)
  write("apps/web/README.md", "`pnpm run test`\n`pnpm test`\n")
  assert.deepEqual(findCommandViolations(root), [
    "apps/web/README.md: unknown pnpm script (test)",
    "apps/web/README.md: unknown pnpm script (test)",
  ])
})

test("checks delegated scripts at their package working directory", (t) => {
  const { root, write } = workspace(t)
  write("packages/example/package.json", {
    name: "@aerpp/example",
    scripts: {
      test: "node --test",
      check:
        "pnpm test && pnpm run missing && pnpm --filter @aerpp/web run removed && pnpm --filter @aerpp/absent run test",
    },
  })
  assert.deepEqual(findCommandViolations(root), [
    "packages/example/package.json scripts.check: unknown pnpm script (missing)",
    "packages/example/package.json scripts.check: unknown pnpm script (@aerpp/web: removed)",
    "packages/example/package.json scripts.check: unknown workspace package (@aerpp/absent)",
  ])
})

test("checks root aliases even when their documented name still exists", (t) => {
  const { root, write } = workspace(t)
  write("apps/web/package.json", { name: "@aerpp/web", scripts: {} })
  write("README.md", "`pnpm run test:web`\n")
  assert.deepEqual(findCommandViolations(root), [
    "package.json scripts.test:web: unknown pnpm script (@aerpp/web: test)",
  ])
})

test("checks pnpm targets moved into the workspace check sequence", (t) => {
  const { root, write } = workspace(t)
  const targets = WORKSPACE_CHECKS.filter(
    ([command]) => command === "pnpm",
  ).map(([, , script]) => script)
  write("package.json", {
    name: "aerpp",
    scripts: {
      ...Object.fromEntries(
        targets.map((script) => [script, "node --version"]),
      ),
      check: "node scripts/checks/check-workspace.mjs",
      verify: "node --test",
    },
  })
  assert.deepEqual(findCommandViolations(root), [])
  write("package.json", {
    name: "aerpp",
    scripts: {
      ...Object.fromEntries(
        targets
          .filter((script) => script !== "check:web")
          .map((script) => [script, "node --version"]),
      ),
      check: "node scripts/checks/check-workspace.mjs",
      verify: "node --test",
    },
  })
  assert.deepEqual(findCommandViolations(root), [
    "scripts/checks/check-workspace.mjs: unknown pnpm script (check:web)",
  ])
})

test("accepts quoted filters, option order, continuations and explicit root commands", (t) => {
  const { root, write } = workspace(t)
  write(
    "docs/commands.md",
    [
      'pnpm --filter="@aerpp/web" --fail-if-no-match run "test"',
      "pnpm --fail-if-no-match --filter '@aerpp/web' run test",
      "pnpm --filter @aerpp/web \\\nrun test",
      "pnpm --workspace-root run verify",
    ].join("\n"),
  )
  assert.deepEqual(findCommandViolations(root), [])
})

test("skips placeholders, non-script commands, historical and private documents", (t) => {
  const { root, write } = workspace(t)
  write(
    "docs/commands.md",
    [
      "`pnpm run <script>` `pnpm run test:<target>`",
      "`pnpm --filter @aerpp/<owner> run verify`",
      'pnpm --filter "$OWNER" run "$COMMAND"',
      "pnpm install --frozen-lockfile",
      "pnpm --filter @aerpp/web exec node script.mjs",
    ].join("\n"),
  )
  for (const file of [
    "CHANGELOG.md",
    "config/production/README.md",
    "private/README.md",
    "apps/web/generated/README.md",
  ])
    write(file, "`pnpm run removed`\n")
  assert.deepEqual(findCommandViolations(root), [])
})

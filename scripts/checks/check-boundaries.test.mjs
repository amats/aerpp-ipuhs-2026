import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { findBoundaryViolations } from "./check-boundaries.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

function workspace(t) {
  const { root, write } = createWorkspace(t, "aerpp-boundaries-")
  write("package.json", { name: "aerpp" })
  for (const owner of [
    "apps/web",
    "apps/admin",
    "apps/support",
    "packages/shared",
  ]) {
    write(`${owner}/package.json`, {
      name: `@aerpp/${path.basename(owner)}`,
      exports: { "./types": "./src/types.ts" },
    })
  }
  return { root, write }
}

test("allows own infrastructure, external dependencies and named package exports", (t) => {
  const { root, write } = workspace(t)
  write("apps/web/src/lib/logger.ts", 'import pino from "pino"\n')
  write(
    "apps/web/src/lib/external/contract.ts",
    'import { z } from "zod"\nexport { value } from "./types"\n',
  )
  write(
    "apps/web/src/features/example/service.ts",
    'import { logger } from "@/lib/logger"\nimport type { Value } from "@aerpp/shared/types"\n',
  )
  write("packages/shared/src/index.ts", 'export { value } from "./types"\n')
  assert.deepEqual(findBoundaryViolations(root), [])
})

for (const owner of ["web", "admin"]) {
  for (const specifier of [
    "@/features/example/types",
    "../features/example/types",
    "@/lib/../features/example/types",
    "@/./ui/button",
    "@/lib/../../src/app/page",
  ]) {
    test(`${owner} rejects lib imports into app layers: ${specifier}`, (t) => {
      const { root, write } = workspace(t)
      write(
        `apps/${owner}/src/lib/invalid.ts`,
        `export { value } from "${specifier}"\n`,
      )
      assert.deepEqual(findBoundaryViolations(root), [
        `apps/${owner}/src/lib/invalid.ts: lib must not depend on application areas (${specifier})`,
      ])
    })
  }
  test(`${owner} rejects UI imports into features and routes`, (t) => {
    const { root, write } = workspace(t)
    write(
      `apps/${owner}/src/ui/button.tsx`,
      'import "@/features/example/actions"\nconst page = import("../app/page")\n',
    )
    assert.equal(findBoundaryViolations(root).length, 2)
    assert.ok(
      findBoundaryViolations(root).every((message) =>
        message.includes("ui must not depend"),
      ),
    )
  })
}

for (const specifier of [
  "../logger",
  "../../features/auth/email",
  "../test-support/helper",
  "@/lib/logger",
  "@aerpp/shared/types",
]) {
  test(`rejects repository imports in external copies: ${specifier}`, (t) => {
    const { root, write } = workspace(t)
    write(
      "apps/web/src/lib/external/contract.ts",
      `import { value } from "${specifier}"\n`,
    )
    assert.deepEqual(findBoundaryViolations(root), [
      `apps/web/src/lib/external/contract.ts: external copies must not import repository code (${specifier})`,
    ])
  })
}

test("rejects cross-app imports and package dependencies on apps", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/src/lib/service.ts",
    'import { value } from "../../../admin/src/lib/service"\n',
  )
  write(
    "apps/support/src/service.ts",
    'const admin = require("@aerpp/admin")\n',
  )
  write(
    "packages/shared/src/index.ts",
    'export { value } from "../../../apps/web/src/lib/service"\n',
  )
  const violations = findBoundaryViolations(root)
  assert.equal(violations.length, 3)
  assert.ok(
    violations.every((message) =>
      message.includes("must not import another application's code"),
    ),
  )
})

test("requires package exports for cross-owner references", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/src/lib/service.ts",
    'import { value } from "../../../../packages/shared/src/types"\nimport "@aerpp/shared/src/types"\n',
  )
  assert.deepEqual(findBoundaryViolations(root), [
    "apps/web/src/lib/service.ts: use the shared package's named exports instead of repository-relative imports (../../../../packages/shared/src/types)",
    "apps/web/src/lib/service.ts: shared package subpath is not exported (@aerpp/shared/src/types)",
  ])
})

test("handles multiline, type-only, side-effect, dynamic and CommonJS imports", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/admin/src/lib/service.ts",
    [
      'import type {\nValue\n} from "@/features/example/types"',
      'export type { Value } from "@/features/example/types"',
      'export { default } from "@/features/example/component"',
      'import { default as component } from "@/features/example/component"',
      'import "@/features/example/setup"',
      'const lazy = import("@/features/example/service")',
      'const cjs = require("@/features/example/service")',
    ].join("\n"),
  )
  assert.equal(findBoundaryViolations(root).length, 7)
})

test("ignores import examples in comments and strings", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/src/lib/example.ts",
    [
      '// import "@/features/example"',
      '/* export { value } from "@/features/example" */',
      "const example = 'import(\"@/features/example\")'",
      'const template = `import "@/features/example"`',
    ].join("\n"),
  )
  assert.deepEqual(findBoundaryViolations(root), [])
})

for (const declaration of [
  'import from from "MODULE"',
  'import { from } from "MODULE"',
  'import { from as value } from "MODULE"',
  'import { value as from } from "MODULE"',
  'export { from } from "MODULE"',
  'export { value as from } from "MODULE"',
  'export * as from from "MODULE"',
  'import * as from from "MODULE"',
  'import { function as callable, class as Widget, import as load, export as expose, const as value, let as mutable } from "MODULE"',
  'export { value as function, value as class, value as import, value as export, value as const, value as let } from "MODULE"',
  'export * as import from "MODULE"',
  'export * as as from "MODULE"',
]) {
  test(`checks the module after contextual and keyword bindings: ${declaration}`, (t) => {
    const { root, write } = workspace(t)
    const file = "apps/web/src/lib/service.ts"
    for (const [specifier, expected] of [
      [
        "@aerpp/admin",
        `${file}: applications and packages must not import another application's code (@aerpp/admin)`,
      ],
      [
        "@/features/example",
        `${file}: lib must not depend on application areas (@/features/example)`,
      ],
      [
        "@aerpp/shared/private",
        `${file}: shared package subpath is not exported (@aerpp/shared/private)`,
      ],
      ["@aerpp/shared/types", undefined],
      ["@/lib/logger", undefined],
    ]) {
      write(file, declaration.replace("MODULE", specifier))
      assert.deepEqual(
        findBoundaryViolations(root),
        expected === undefined ? [] : [expected],
      )
    }
  })
}

test("leaves computed imports to review but checks literal imports with options", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/src/lib/example.ts",
    [
      'const computed = import("@/features/" + feature)',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source fixture for a computed module name
      "const template = import(`@/features/${feature}`)",
      'const literal = import("@/features/example", { with: { type: "json" } })',
    ].join("\n"),
  )
  assert.deepEqual(findBoundaryViolations(root), [
    "apps/web/src/lib/example.ts: lib must not depend on application areas (@/features/example)",
  ])
})

test("can check one owner and rejects an unknown selection", (t) => {
  const { root, write } = workspace(t)
  write("apps/admin/src/ui/button.tsx", 'import "@/features/example"\n')
  assert.deepEqual(findBoundaryViolations(root, "apps/web"), [])
  assert.equal(findBoundaryViolations(root, "apps/admin").length, 1)
  assert.deepEqual(findBoundaryViolations(root, "apps/absent"), [
    "unknown source owner (apps/absent)",
  ])
})

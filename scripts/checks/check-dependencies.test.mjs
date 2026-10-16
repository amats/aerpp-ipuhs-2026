import assert from "node:assert/strict"
import { test } from "node:test"
import { findDependencyViolations } from "./check-dependencies.mjs"

test("allows shared catalogs, workspace links and single-owner dependencies", () => {
  assert.deepEqual(
    findDependencyViolations(
      { catalog: { zod: "^4.6.5" } },
      {
        ".": { name: "aerpp", devDependencies: { yaml: "^2.9.1" } },
        "apps/web": {
          name: "@aerpp/web",
          dependencies: { "@aerpp/config": "workspace:*", zod: "catalog:" },
        },
        "packages/config": {
          name: "@aerpp/config",
          dependencies: { zod: "catalog:" },
        },
      },
    ),
    [],
  )
})

test("rejects duplicated direct versions across dependency fields", () => {
  const violations = findDependencyViolations(
    {},
    {
      "apps/web": { dependencies: { "iron-session": "^9.0.1" } },
      "apps/admin": { devDependencies: { "iron-session": "9.0.1" } },
    },
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /iron-session: shared by/)
})

test("rejects bypassed, missing and unused catalog entries", () => {
  const violations = findDependencyViolations(
    { catalog: { zod: "^4.6.5", typescript: "^7.0.2" } },
    {
      "apps/web": {
        dependencies: { zod: "^4.6.5", next: "catalog:" },
      },
      "apps/support": { dependencies: { zod: "catalog:" } },
    },
  )
  assert.equal(violations.length, 3)
  assert.ok(violations.some((line) => line.includes("reference the catalog")))
  assert.ok(violations.some((line) => line.includes("missing default")))
  assert.ok(violations.some((line) => line.includes("typescript: remove")))
})

test("counts owners rather than repeated declarations in one package", () => {
  assert.deepEqual(
    findDependencyViolations(
      {},
      {
        "apps/web": {
          devDependencies: { react: "^19" },
          peerDependencies: { react: "^19" },
        },
      },
    ),
    [],
  )
})

test("validates named catalogs without requiring one version for every consumer", () => {
  assert.deepEqual(
    findDependencyViolations(
      { catalog: { react: "^19" }, catalogs: { legacy: { react: "^18" } } },
      {
        "apps/web": { dependencies: { react: "catalog:" } },
        "apps/legacy": { dependencies: { react: "catalog:legacy" } },
      },
    ),
    [],
  )
})

test("keeps internal dependencies out of registries and catalogs", () => {
  const violations = findDependencyViolations(
    { catalog: { "@aerpp/config": "1.0.0" } },
    {
      "packages/config": { name: "@aerpp/config" },
      "apps/web": { dependencies: { "@aerpp/config": "catalog:" } },
    },
  )
  assert.ok(violations.some((line) => line.includes("use workspace:*")))
  assert.ok(violations.some((line) => line.includes("internal packages use")))
})

test("accepts the default catalog declared under catalogs", () => {
  assert.deepEqual(
    findDependencyViolations(
      { catalogs: { default: { zod: "^4.6.5" } } },
      { "apps/web": { dependencies: { zod: "catalog:" } } },
    ),
    [],
  )
})

test("rejects moving a coupled package out of the catalog", () => {
  const violations = findDependencyViolations(
    { catalog: { next: "^16.3.8" } },
    {
      "apps/web": {
        dependencies: { next: "catalog:", "@next/mdx": "^16.3.8" },
      },
    },
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /@next\/mdx: upgraded with/)
})

test("rejects drift between packages released together", () => {
  for (const [first, second] of [
    ["next", "@next/mdx"],
    ["react", "react-dom"],
    ["tailwindcss", "@tailwindcss/postcss"],
  ]) {
    const violations = findDependencyViolations(
      { catalog: { [first]: "^1.0.0", [second]: "^1.0.1" } },
      {
        "apps/web": {
          dependencies: { [first]: "catalog:", [second]: "catalog:" },
        },
      },
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /same version range/)
  }
})

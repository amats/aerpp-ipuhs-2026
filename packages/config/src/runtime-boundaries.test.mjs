import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

test("pure runtime readers never load filesystem, workspace or Next.js modules", () => {
  const script = `
    import { registerHooks } from "node:module"
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("node:") || specifier === "server-only")
          throw new Error("Unexpected runtime dependency: " + specifier)
        return nextResolve(specifier, context)
      }
    })
    await import("@aerpp/config")
    await import("@aerpp/config/web")
    await import("@aerpp/config/admin")
  `
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {},
    },
  )
  assert.equal(result.status, 0, result.stderr)
})

test("Next.js runtime entrypoints enforce server-only before reading environment values", () => {
  for (const app of ["web", "admin"]) {
    const script = `
      import assert from "node:assert/strict"
      import { registerHooks } from "node:module"
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === "server-only") throw new Error("server-only boundary")
          return nextResolve(specifier, context)
        }
      })
      await assert.rejects(import("@aerpp/config/server/${app}"), /server-only boundary/)
    `
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {},
      },
    )
    assert.equal(result.status, 0, result.stderr)
  }
})

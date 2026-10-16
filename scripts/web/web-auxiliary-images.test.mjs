import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  assertAuxiliaryImages,
  prepareAuxiliaryImages,
} from "./web-auxiliary-images.mjs"

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-auxiliary-test-"))
  for (const file of [
    "compose.yaml",
    "Caddyfile",
    "fluent-bit.conf",
    "parsers.conf",
  ])
    copyFileSync(resolve("infra", file), resolve(directory, file))
  const calls = []
  let proxy
  const ids = {
    "caddy:latest": `sha256:${"a".repeat(64)}`,
    "fluent/fluent-bit:latest": `sha256:${"b".repeat(64)}`,
  }
  const invoke = (command, args) => {
    assert.equal(command, "docker")
    calls.push(args)
    if (args[0] === "image")
      return JSON.stringify([
        { Id: ids[args[2]], Os: "linux", Architecture: "arm64" },
      ])
    if (args[0] === "create") {
      const id = `synthetic-container-${calls.length}`
      if (args.includes("run")) proxy = id
      return id
    }
    if (args[0] === "inspect") return "0"
    if (args[0] === "exec") return "aerpp-synthetic-forward-check"
    if (args[0] === "logs" && args[1] === proxy)
      return JSON.stringify({
        request: { uri: "/health", method: "POST" },
        status: 502,
      })
    if (args[0] === "logs")
      return '"message"=>"aerpp-synthetic-forward-check", "service"=>"app-aerpp"'
    return ""
  }
  return { directory, calls, ids, invoke }
}

test("each build pulls latest, checks exact image IDs and retains both local traffic checks", () => {
  const f = fixture()
  try {
    const evidence = prepareAuxiliaryImages(
      "linux/arm64",
      f.invoke,
      f.directory,
    )
    assertAuxiliaryImages(evidence, "linux/arm64", f.directory)
    assert.deepEqual(
      f.calls.filter((args) => args[0] === "pull"),
      [
        ["pull", "--platform", "linux/arm64", "caddy:latest"],
        ["pull", "--platform", "linux/arm64", "fluent/fluent-bit:latest"],
      ],
    )
    assert.deepEqual(
      evidence.images.map((image) => image.id),
      Object.values(f.ids),
    )
    for (const args of f.calls.filter((args) => args[0] === "create")) {
      assert(args.includes("never"))
      assert(args.some((arg) => Object.values(f.ids).includes(arg)))
      assert(!args.some((arg) => arg.endsWith(":latest")))
    }
    assert(f.calls.some((args) => args.includes("validate")))
    assert(f.calls.some((args) => args.includes("--dry-run")))
    assert(
      f.calls.some(
        (args) => args[0] === "network" && args.includes("--internal"),
      ),
    )
    assert(f.calls.some((args) => args[0] === "network" && args[1] === "rm"))
    writeFileSync(resolve(f.directory, "Caddyfile"), "changed")
    assert.throws(
      () => assertAuxiliaryImages(evidence, "linux/arm64", f.directory),
      /configuration changed/,
    )
  } finally {
    rmSync(f.directory, { recursive: true, force: true })
  }
})

test("pull and configuration failures cannot silently reuse old auxiliary acceptance", () => {
  for (const failure of ["pull", "inspect"]) {
    const f = fixture()
    try {
      assert.throws(() =>
        prepareAuxiliaryImages(
          "linux/arm64",
          (command, args) => {
            if (args[0] === failure) {
              if (failure === "pull")
                throw new Error("Synthetic registry unavailable")
              return "1"
            }
            return f.invoke(command, args)
          },
          f.directory,
        ),
      )
      if (failure === "pull") assert.equal(f.calls.length, 0)
      else assert(f.calls.some((args) => args[0] === "rm"))
    } finally {
      rmSync(f.directory, { recursive: true, force: true })
    }
  }
})

test("acceptance cannot omit a service, use another platform or skip traffic checks", () => {
  const f = fixture()
  try {
    const evidence = prepareAuxiliaryImages(
      "linux/arm64",
      f.invoke,
      f.directory,
    )
    assert.throws(() =>
      assertAuxiliaryImages(undefined, "linux/arm64", f.directory),
    )
    assert.throws(() =>
      assertAuxiliaryImages(evidence, "linux/amd64", f.directory),
    )
    assert.throws(() =>
      assertAuxiliaryImages(
        { ...evidence, images: evidence.images.slice(1) },
        "linux/arm64",
        f.directory,
      ),
    )
    assert.throws(() =>
      assertAuxiliaryImages(
        { ...evidence, localProxyCheck: false },
        "linux/arm64",
        f.directory,
      ),
    )
    assert.throws(() =>
      assertAuxiliaryImages(
        { ...evidence, loggingForwardCheck: false },
        "linux/arm64",
        f.directory,
      ),
    )
    assert.throws(() =>
      assertAuxiliaryImages(
        { ...evidence, images: [evidence.images[0], evidence.images[0]] },
        "linux/arm64",
        f.directory,
      ),
    )
  } finally {
    rmSync(f.directory, { recursive: true, force: true })
  }
})

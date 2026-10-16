import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  collectApplication,
  collectNativeNotices,
  collectNoticeFiles,
} from "./collect-license-notices.mjs"

test("native supplements preserve text and reject component drift or damaged notices", () => {
  const text = "Copyright native component\r\nVerbatim license text\r\n"
  const bundle = {
    components: [
      {
        name: "native",
        version: "1.0.0",
        source: "https://example.invalid/native-1.0.0.tar.gz",
        notices: [
          {
            path: "COPYING",
            text,
            sha256: createHash("sha256").update(text).digest("hex"),
          },
        ],
      },
    ],
    commonNotices: [],
  }
  assert.equal(collectNativeNotices(bundle, { native: "1.0.0" })[0].text, text)
  for (const versions of [
    {},
    { native: "2.0.0" },
    { native: "1.0.0", added: "1.0.0" },
  ]) {
    assert.throws(
      () => collectNativeNotices(bundle, versions),
      /versions changed/,
    )
  }
  const changed = structuredClone(bundle)
  changed.components[0].notices[0].text = "Different text"
  assert.throws(
    () => collectNativeNotices(changed, { native: "1.0.0" }),
    /differs from/,
  )
  changed.components[0].notices = []
  assert.throws(
    () => collectNativeNotices(changed, { native: "1.0.0" }),
    /Missing native/,
  )
})

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "aerpp-notices-"))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function packageAt(root, name, manifest, files = {}) {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({ name, version: "1.0.0", license: "MIT", ...manifest }),
  )
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(path, file, ".."), { recursive: true })
    writeFileSync(join(path, file), text)
  }
  return { path }
}

test("retains verbatim nested notices and skips unrelated node_modules and tests", () =>
  fixture((root) => {
    const node = packageAt(
      root,
      "package",
      {},
      {
        LICENSE: "Copyright original\r\nPermission notice\r\n",
        "dist/vendor/index.js.LICENSE.txt": "Bundled third party attribution",
        "node_modules/unrelated/LICENSE": "Do not collect",
        "tests/fixture/LICENSE": "Do not collect",
      },
    )
    assert.deepEqual(collectNoticeFiles(node.path), [
      {
        file: "dist/vendor/index.js.LICENSE.txt",
        text: "Bundled third party attribution",
      },
      { file: "LICENSE", text: "Copyright original\r\nPermission notice\r\n" },
    ])
  }))

test("visits full dependency edges even when pnpm emitted an earlier abbreviated reference", () =>
  fixture((root) => {
    const dependency = packageAt(
      root,
      "dependency",
      {},
      { LICENSE: "Copyright dependency" },
    )
    const shared = packageAt(
      root,
      "shared",
      {},
      { LICENSE: "Copyright shared" },
    )
    const app = packageAt(root, "@aerpp/app", {})
    app.dependencies = {
      abbreviated: shared,
      full: { ...shared, dependencies: { dependency } },
      absent: { path: join(root, "absent-platform-binary") },
    }
    assert.deepEqual(
      collectApplication(app).map((item) => item.name),
      ["dependency", "shared"],
    )
  }))

test("preserves explicit license selections and flags missing text rather than inventing it", () =>
  fixture((root) => {
    const app = packageAt(root, "@aerpp/app", {})
    app.dependencies = {
      dompurify: packageAt(
        root,
        "dompurify",
        { license: "(MPL-2.0 OR Apache-2.0)" },
        { LICENSE: "Unchanged upstream dual-license notice" },
      ),
      jszip: packageAt(root, "jszip", { license: "(MIT OR GPL-3.0-or-later)" }),
      old: packageAt(root, "old", {
        license: undefined,
        licenses: [{ type: "ISC" }],
      }),
    }
    const entries = collectApplication(app)
    assert.equal(entries[0].license, "Apache-2.0")
    assert.equal(
      entries[0].notices[0].text,
      "Unchanged upstream dual-license notice",
    )
    assert.equal(entries[1].license, "MIT")
    assert.deepEqual(entries[1].notices, [])
    assert.equal(entries[2].license, "ISC")
  }))

test("extracts a full README license but does not mistake a license-name link for its text", () =>
  fixture((root) => {
    const app = packageAt(root, "@aerpp/app", {})
    app.dependencies = {
      full: packageAt(
        root,
        "full",
        {},
        {
          "README.md":
            "# Package\n## License\nCopyright Example\nPermission is hereby granted, ...",
        },
      ),
      link: packageAt(
        root,
        "link",
        {},
        { "README.md": "## License\n[MIT](https://example.invalid/license)" },
      ),
    }
    const entries = collectApplication(app)
    assert.match(entries[0].notices[0].text, /^Copyright Example/)
    assert.deepEqual(entries[1].notices, [])
  }))

test("requires review when an upstream license no longer permits the selected alternative", async () => {
  const { selectedLicense } = await import("./collect-license-notices.mjs")
  assert.throws(
    () =>
      selectedLicense({
        name: "dompurify",
        version: "future",
        license: "MPL-2.0",
      }),
    /Review license selection/,
  )
  assert.throws(
    () =>
      selectedLicense({
        name: "jszip",
        version: "future",
        license: "MIT AND GPL-3.0-or-later",
      }),
    /Review license selection/,
  )
  assert.equal(
    selectedLicense({ name: "empty", license: "", licenses: [] }),
    "UNKNOWN",
  )
})

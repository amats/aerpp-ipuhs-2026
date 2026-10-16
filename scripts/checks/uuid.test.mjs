import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

function googleHttpClient(app) {
  const appRequire = createRequire(
    new URL(`../../apps/${app}/package.json`, import.meta.url),
  )
  let parentRequire
  if (app === "functions") {
    const firebaseRequire = createRequire(
      appRequire.resolve("firebase-admin/app"),
    )
    parentRequire = createRequire(
      firebaseRequire.resolve("@google-cloud/storage"),
    )
  } else {
    const firestoreRequire = createRequire(
      appRequire.resolve("@google-cloud/firestore"),
    )
    const gaxRequire = createRequire(firestoreRequire.resolve("google-gax"))
    parentRequire = createRequire(gaxRequire.resolve("google-auth-library"))
  }
  const httpRequire = createRequire(parentRequire.resolve("gaxios"))
  return { uuid: httpRequire("uuid"), Gaxios: parentRequire("gaxios").Gaxios }
}

for (const app of ["admin", "support"]) {
  test(`${app} Google dependency rejects invalid UUID buffers before writing`, () => {
    const { uuid } = googleHttpClient(app)
    const generators = [
      (buffer, offset) => uuid.v3("synthetic", uuid.v3.DNS, buffer, offset),
      (buffer, offset) => uuid.v5("synthetic", uuid.v5.DNS, buffer, offset),
      (buffer, offset) =>
        uuid.v6(
          { msecs: 0, nsecs: 0, clockseq: 0, node: [1, 2, 3, 4, 5, 6] },
          buffer,
          offset,
        ),
    ]
    for (const generate of generators) {
      for (const [size, offset] of [
        [8, 4],
        [16, -1],
        [16, 1],
        [16, 17],
      ]) {
        for (const buffer of [
          new Uint8Array(size).fill(170),
          Buffer.alloc(size, 170),
          new Array(size).fill(170),
        ]) {
          const before = Array.from(buffer)
          assert.throws(() => generate(buffer, offset), RangeError)
          assert.deepEqual(Array.from(buffer), before)
        }
      }
      const buffer = new Uint8Array(24).fill(170)
      const expected = generate()
      assert.equal(generate(buffer, 4), buffer)
      assert.equal(uuid.stringify(buffer, 4), expected)
      assert.deepEqual(Array.from(buffer.subarray(0, 4)), [170, 170, 170, 170])
      assert.deepEqual(Array.from(buffer.subarray(20)), [170, 170, 170, 170])
    }
    assert.equal(uuid.validate(uuid.v4()), true)
  })

  test(`${app} Google HTTP multipart generation retains its UUID boundary without network`, async () => {
    const { uuid, Gaxios } = googleHttpClient(app)
    let calls = 0
    const client = new Gaxios()
    const response = await client.request({
      url: "https://example.invalid/upload",
      method: "POST",
      noProxy: ["example.invalid"],
      multipart: [
        {
          headers:
            app === "functions"
              ? { "Content-Type": "text/plain" }
              : new Headers({ "Content-Type": "text/plain" }),
          content: "synthetic-part",
        },
      ],
      adapter: async (options) => {
        calls++
        const contentType =
          options.headers instanceof Headers
            ? options.headers.get("Content-Type")
            : options.headers["Content-Type"]
        const boundary = contentType.split("boundary=")[1]
        assert.equal(uuid.validate(boundary), true)
        assert.equal(uuid.version(boundary), 4)
        let body = ""
        for await (const chunk of options.body) body += chunk.toString()
        assert.ok(body.includes(`--${boundary}\r\n`))
        assert.ok(body.includes("synthetic-part"))
        assert.ok(body.includes(`--${boundary}--`))
        return {
          config: options,
          data: "ok",
          status: 200,
          statusText: "OK",
          headers: {},
        }
      },
    })
    assert.equal(calls, 1)
    assert.equal(response.data, "ok")
  })
}

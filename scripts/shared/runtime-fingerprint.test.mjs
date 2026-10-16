import assert from "node:assert/strict"
import { test } from "node:test"
import { runtimeFingerprint } from "./runtime-fingerprint.mjs"

test("runtime fingerprints preserve literal settings and are independent of key order", () => {
  const settings = {
    ADMIN_ALLOWED_EMAILS: "admin@example.invalid",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Synthetic literal secret, not interpolation.
    NEXTAUTH_SECRET: " $literal-${VALUE}-'quotes'-\\slash\nsecret ",
  }
  const hash = runtimeFingerprint(settings)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(
    runtimeFingerprint(Object.fromEntries(Object.entries(settings).reverse())),
    hash,
  )
  for (const key of Object.keys(settings))
    assert.notEqual(
      runtimeFingerprint({ ...settings, [key]: `${settings[key]}changed` }),
      hash,
    )
  for (const settings of [
    undefined,
    null,
    [],
    { SECRET: undefined },
    { PORT: 1 },
  ])
    assert.throws(
      () => runtimeFingerprint(settings),
      /projected string settings/,
    )
})

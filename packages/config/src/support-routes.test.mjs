import assert from "node:assert/strict"
import { test } from "node:test"
import { buildSupportUrls } from "./support-routes.mjs"

test("support routing builds operation URLs from one origin with distinct operator and confirmation boundaries", () => {
  const urls = buildSupportUrls("https://support.example.invalid/")
  assert.equal(
    urls.sendMagicLink,
    "https://support.example.invalid/api/participant/send-magic-link",
  )
  assert.equal(
    urls.magicCompletePage,
    "https://support.example.invalid/email/confirm",
  )
  assert.equal(
    urls.addInformation,
    "https://support.example.invalid/api/operator/information",
  )
  assert.ok(Object.isFrozen(urls))
  assert.equal(
    buildSupportUrls("http://127.0.0.1:8080").getInformation,
    "http://127.0.0.1:8080/api/participant/information",
  )
})

test("support routing rejects ambiguous or unsafe origins rather than silently dropping input", () => {
  for (const base of [
    "",
    "/relative",
    "https://support.example.invalid/prefix",
    "https://support.example.invalid?token=secret",
    "https://support.example.invalid#secret",
    "https://user:password@support.example.invalid",
    "http://support.example.invalid",
    "file:///tmp/support",
  ])
    assert.throws(() => buildSupportUrls(base))
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { readAccessProfile } from "./access-profile.mjs"

const access = () => ({
  revoked: false,
  notBefore: "1970-01-01T00:00:00Z",
  expiresAt: "2026-10-31T23:59:59.999+09:00",
  backendStopsAt: "2026-11-30T23:59:59.999+09:00",
})

test("shared access preserves timezone-qualified dates and explicit revocation", () => {
  for (const revoked of [false, true]) {
    const input = { ...access(), revoked }
    assert.deepEqual(readAccessProfile(input), input)
  }
  const input = access()
  input.backendStopsAt = input.expiresAt
  assert.deepEqual(readAccessProfile(input), input)
})

test("all access dates require valid ISO timestamps with explicit time zones", () => {
  for (const value of [
    undefined,
    null,
    0,
    "2026-09-21",
    "2026-09-21T12:00:00",
    "2026-02-30T00:00:00Z",
    "invalid-private-value",
  ]) {
    for (const field of ["notBefore", "expiresAt", "backendStopsAt"])
      assert.throws(
        () => readAccessProfile({ ...access(), [field]: value }),
        (error) =>
          error.message.includes("support.access") &&
          error.message.includes(field) &&
          !error.message.includes("invalid-private-value"),
      )
  }
})

test("access requires a nonnegative start, a later reception expiry and no earlier backend stop", () => {
  for (const patch of [
    { notBefore: "1969-12-31T23:59:59Z" },
    { expiresAt: "1970-01-01T00:00:00Z" },
    { expiresAt: "1969-12-31T23:59:59Z" },
    { backendStopsAt: "2026-10-31T23:59:59.998+09:00" },
  ])
    assert.throws(() => readAccessProfile({ ...access(), ...patch }))
})

test("revocation must be an explicit boolean", () => {
  for (const revoked of [undefined, null, "false", "true", 0, 1, {}, []])
    assert.throws(
      () => readAccessProfile({ ...access(), revoked }),
      /support.access.*revoked/,
    )
})

test("shared access rejects missing policy and generated or operation overrides", () => {
  for (const input of [undefined, null, {}, [], "private-value"])
    assert.throws(() => readAccessProfile(input), /support.access/)
  for (const patch of [
    { operations: ["addInformation"] },
    { expiresAtMs: 0 },
    { webAccess: access() },
  ])
    assert.throws(() => readAccessProfile({ ...access(), ...patch }))
})

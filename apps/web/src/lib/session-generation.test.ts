import { afterEach, expect, it, vi } from "vitest"
import { createTabId, readTabGeneration } from "./session-generation"

afterEach(() => vi.unstubAllGlobals())
it("sets RFC UUID version and variant bits using browser-safe random bytes", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => bytes.fill(255),
  })
  expect(createTabId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
})

const scope = "11111111-1111-1111-1111-111111111111"
const hash = "a".repeat(64)

it("reads the generation only from a current consistency hash", () => {
  expect(readTabGeneration(`${scope}:${hash}`)).toBe(scope)
  expect(readTabGeneration(`${scope}:${hash}:sealed-context`)).toBe(scope)
  expect(readTabGeneration(`${scope}:${scope}`)).toBeNull()
})

it.each([
  undefined,
  null,
  {},
  scope,
  `${scope}:${"a".repeat(63)}`,
  `${scope}:${"g".repeat(64)}`,
  `invalid:${hash}`,
  `${scope}:${hash}:${"a".repeat(32_769)}`,
  `${scope}:${hash}:context:extra`,
])("rejects malformed session stamps (case %#)", (value) => {
  expect(readTabGeneration(value)).toBeNull()
})

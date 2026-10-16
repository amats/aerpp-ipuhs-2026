import { sealData, unsealData } from "iron-session"
import { afterEach, expect, it, vi } from "vitest"
import { decryptExportEmail } from "./export-email"

const PASSWORD = "synthetic-export-email-password-for-tests"
const EMAIL = "participant@example.invalid"
afterEach(() => vi.useRealTimers())

it("decrypts Web iron-session email seals, including expired retained records", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2000-01-01T00:00:00Z"))
  const sealed = await sealData(EMAIL, { password: { 1: PASSWORD }, ttl: 60 })
  await expect(decryptExportEmail(sealed, PASSWORD)).resolves.toBe(EMAIL)
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"))
  await expect(unsealData(sealed, { password: PASSWORD })).resolves.toEqual({})
  await expect(decryptExportEmail(sealed, PASSWORD)).resolves.toBe(EMAIL)
})

it("rejects wrong keys and tampering, including changes to expiry", async () => {
  const sealed = await sealData(EMAIL, { password: PASSWORD })
  await expect(decryptExportEmail(sealed, `${PASSWORD}-wrong`)).rejects.toThrow(
    "Cannot decrypt export email",
  )
  for (const index of [4, 5, 7]) {
    const parts = sealed.split("*")
    parts[index] =
      index === 5
        ? "1"
        : `${parts[index][0] === "A" ? "B" : "A"}${parts[index].slice(1)}`
    await expect(decryptExportEmail(parts.join("*"), PASSWORD)).rejects.toThrow(
      "Cannot decrypt export email",
    )
  }
})

it.each(["", "invalid-email", { email: EMAIL }, null])(
  "rejects non-email payloads without leaking values",
  async (value) => {
    const sealed = await sealData(value, { password: PASSWORD })
    await expect(decryptExportEmail(sealed, PASSWORD)).rejects.toThrow(
      /^Cannot decrypt export email$/,
    )
  },
)

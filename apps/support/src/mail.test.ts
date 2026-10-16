import { expect, it, vi } from "vitest"
import { GmailMailer } from "./mail.js"

const settings = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  refreshToken: "synthetic-refresh",
  sender: "sender@example.invalid",
  participantEmailPattern: "^recipient@example\\.invalid$",
}
const link = "https://support.example.invalid/email/confirm#token=synthetic"
it("health refreshes without mail, caches tokens and sends only to the allowlisted recipient", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ access_token: "synthetic-access", expires_in: 3600 }),
    )
    .mockResolvedValueOnce(Response.json({ id: "synthetic-id" }))
  const mail = new GmailMailer(settings, request)
  await Promise.all([mail.health(), mail.health()])
  expect(request).toHaveBeenCalledTimes(1)
  await expect(mail.send("other@example.invalid", link)).rejects.toMatchObject({
    code: "MAIL_RECIPIENT_FORBIDDEN",
  })
  await mail.send("recipient@example.invalid", link)
  expect(request).toHaveBeenCalledTimes(2)
  const data = JSON.parse(String(request.mock.calls[1][1]?.body))
  const mime = Buffer.from(data.raw, "base64url").toString()
  expect(mime).toContain("To: recipient@example.invalid\r\n")
  expect(Buffer.from(mime.split("\r\n\r\n")[1], "base64").toString()).toContain(
    link,
  )
})
it.each(["invalid_grant", "invalid_client", "unauthorized_client"])(
  "OAuth %s requires operator reauthorization and never exposes raw error details",
  async (error) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error, error_description: settings.refreshToken },
          { status: 400 },
        ),
      )
    await expect(
      new GmailMailer(settings, request).health(),
    ).rejects.toMatchObject({
      code: "MAIL_REAUTHORIZATION_REQUIRED",
      message: "sender reauthorization required",
    })
  },
)
it("transport and send failures distinguish transient refresh from ambiguous delivery", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error(settings.clientSecret))
  const mail = new GmailMailer(settings, request)
  await expect(mail.health()).rejects.toMatchObject({
    code: "MAIL_TEMPORARILY_UNAVAILABLE",
  })
  request
    .mockResolvedValueOnce(
      Response.json({ access_token: "synthetic-access", expires_in: 3600 }),
    )
    .mockRejectedValueOnce(new Error(settings.refreshToken))
  await expect(
    mail.send("recipient@example.invalid", link),
  ).rejects.toMatchObject({ code: "MAIL_DELIVERY_UNCONFIRMED" })
})

it("recipient patterns permit multiple matching addresses and reject outsiders before network access", async () => {
  const request = vi.fn<typeof fetch>()
  const mail = new GmailMailer(
    { ...settings, participantEmailPattern: "/^[^@]+@example[.]invalid$/gi" },
    request,
  )
  for (const email of [
    "first@example.invalid",
    "second@example.invalid",
    "first@example.invalid",
  ])
    expect(() => mail.assertRecipient(email)).not.toThrow()
  for (const email of [
    "first@other.invalid",
    "first@example.invalid.evil",
    "first@example.invalid\r\nBcc: other@example.invalid",
  ])
    await expect(mail.send(email, link)).rejects.toMatchObject({
      code: "MAIL_RECIPIENT_FORBIDDEN",
    })
  expect(request).not.toHaveBeenCalled()
})

it("does not begin OAuth or delivery when their full time budgets cannot fit", async () => {
  let now = 100_000
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
  const request = vi.fn<typeof fetch>().mockImplementation(async () => {
    now += 35_000
    return Response.json({ access_token: "synthetic-access", expires_in: 3600 })
  })
  try {
    const mail = new GmailMailer(settings, request)
    await expect(
      mail.send("recipient@example.invalid", link, now + 20_000),
    ).rejects.toMatchObject({ code: "MAIL_TEMPORARILY_UNAVAILABLE" })
    expect(request).not.toHaveBeenCalled()
    await expect(
      mail.send("recipient@example.invalid", link, now + 50_000),
    ).rejects.toMatchObject({ code: "MAIL_TEMPORARILY_UNAVAILABLE" })
    expect(request).toHaveBeenCalledOnce()
    expect(String(request.mock.calls[0][0])).toBe(
      "https://oauth2.googleapis.com/token",
    )
  } finally {
    clock.mockRestore()
  }
})

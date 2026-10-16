import { participantEmailRegexp, type Runtime } from "@aerpp/config/support"
import { z } from "zod"
import { ApiError, throwApiError } from "./api-errors.js"
import {
  MAIL_DEPENDENCY_TIMEOUT_MS,
  MAIL_WORK_BUDGET_MS,
} from "./mail-constraints.js"

function requireMailTime(deadline: number, remaining = 0) {
  if (Date.now() + remaining >= deadline)
    throw new ApiError(
      503,
      "MAIL_TEMPORARILY_UNAVAILABLE",
      "mail temporarily unavailable",
    )
}

export interface Mailer {
  assertRecipient(email: string): void
  send(email: string, confirmationUrl: string, deadline?: number): Promise<void>
  health(): Promise<void>
}
export class MailSink implements Mailer {
  readonly messages: { email: string; confirmationUrl: string }[] = []
  assertRecipient(email: string) {
    if (!z.email().safeParse(email).success)
      throwApiError(400, "INVALID_REQUEST", "invalid recipient")
  }
  async send(
    email: string,
    confirmationUrl: string,
    deadline = Date.now() + MAIL_WORK_BUDGET_MS,
  ) {
    requireMailTime(deadline)
    this.assertRecipient(email)
    this.messages.push({ email, confirmationUrl })
    if (this.messages.length > 100) this.messages.shift()
  }
  async health() {}
}

export class GmailMailer implements Mailer {
  private cached?: { token: string; expiresAt: number }
  private refreshing?: Promise<string>
  constructor(
    private readonly settings: NonNullable<Runtime["gmail"]>,
    private readonly request: typeof fetch = fetch,
  ) {}
  assertRecipient(email: string) {
    if (
      !z.email().safeParse(email).success ||
      !participantEmailRegexp(this.settings.participantEmailPattern).test(email)
    )
      throwApiError(403, "MAIL_RECIPIENT_FORBIDDEN", "recipient not allowed")
  }
  private async refresh(): Promise<string> {
    let response: Response
    try {
      response = await this.request("https://oauth2.googleapis.com/token", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(MAIL_DEPENDENCY_TIMEOUT_MS),
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          refresh_token: this.settings.refreshToken,
        }),
      })
    } catch {
      throw new ApiError(
        503,
        "MAIL_TEMPORARILY_UNAVAILABLE",
        "mail temporarily unavailable",
      )
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (!response.ok) {
      if (
        ["invalid_grant", "invalid_client", "unauthorized_client"].includes(
          String(body.error),
        )
      )
        throw new ApiError(
          503,
          "MAIL_REAUTHORIZATION_REQUIRED",
          "sender reauthorization required",
        )
      throw new ApiError(
        503,
        "MAIL_TEMPORARILY_UNAVAILABLE",
        "mail temporarily unavailable",
      )
    }
    if (
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    )
      throw new ApiError(
        503,
        "MAIL_TEMPORARILY_UNAVAILABLE",
        "mail temporarily unavailable",
      )
    this.cached = {
      token: body.access_token,
      expiresAt: Date.now() + Math.min(body.expires_in, 3600) * 1000,
    }
    return body.access_token
  }
  private async accessToken() {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000)
      return this.cached.token
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined
      })
    return this.refreshing
  }
  async health() {
    await this.accessToken()
  }
  async send(
    email: string,
    confirmationUrl: string,
    deadline = Date.now() + MAIL_WORK_BUDGET_MS,
  ) {
    this.assertRecipient(email)
    if (
      /[\r\n]/.test(this.settings.sender) ||
      !z.email().safeParse(this.settings.sender).success
    )
      throw new ApiError(
        503,
        "MAIL_TEMPORARILY_UNAVAILABLE",
        "mail temporarily unavailable",
      )
    const cached =
      this.cached !== undefined && this.cached.expiresAt > Date.now() + 60_000
    requireMailTime(
      deadline,
      MAIL_DEPENDENCY_TIMEOUT_MS * (cached ? 1 : 2) + 1000,
    )
    const token = await this.accessToken()
    // Await the committed authentication, but do not start late delivery work.
    requireMailTime(deadline, MAIL_DEPENDENCY_TIMEOUT_MS + 1000)
    const body = `AERPP のメール確認です。以下のリンクを開き、確認ボタンを押してください。\n\n${confirmationUrl}\n\nこのメールに心当たりがない場合は、操作せず破棄してください。`
    const raw = [
      `From: ${this.settings.sender}`,
      `To: ${email}`,
      "Subject: AERPP email confirmation",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "",
    ].join("\r\n")
    let response: Response
    try {
      response = await this.request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(MAIL_DEPENDENCY_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
        },
      )
    } catch {
      throw new ApiError(
        503,
        "MAIL_DELIVERY_UNCONFIRMED",
        "mail delivery unconfirmed; retry the same request",
      )
    }
    if (!response.ok) {
      if (response.status === 401) this.cached = undefined
      throw new ApiError(
        503,
        "MAIL_DELIVERY_UNCONFIRMED",
        "mail delivery unconfirmed; retry the same request",
      )
    }
  }
}

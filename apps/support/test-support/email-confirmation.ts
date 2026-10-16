import type { Firestore } from "@google-cloud/firestore"
import { issueEmailConfirmation } from "../src/email-authentication.js"
import { MailSink } from "../src/mail.js"
import { withDatabase } from "../src/storage.js"
import { MemoryFirestore } from "./firestore.js"
import { syntheticRuntime } from "./runtime.js"

// Each suite resets its database, mail sink and runtime before every case.
export function createEmailConfirmationFixture() {
  const now = Date.parse("2026-09-20T12:00:00Z")
  const request = {
    consentId: "AbCdEfGhIjKlMnOpQrSt",
    expiresAtMs: now + 3600000,
    expectedWithdrawalId: null,
    expectedRecoveryId: null as string | null,
    expectedStudyGeneration: null as string | null,
    serverId: "server-1",
    clientId: "client-1",
    pseudonym: "participant-1",
    email: "synthetic@example.invalid",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: "synthetic-ciphertext",
  }
  const db = new MemoryFirestore()
  const mail = new MailSink()
  const runtime = syntheticRuntime()
  const run = <T>(fn: () => T) => withDatabase(db as unknown as Firestore, fn)
  const send = (body: unknown = request) =>
    run(() => issueEmailConfirmation(body, "local", runtime, mail))
  const confirmation = (index = 0) =>
    Object.fromEntries(
      new URLSearchParams(
        new URL(mail.messages[index].confirmationUrl).hash.slice(1),
      ),
    )
  return { now, request, db, mail, runtime, run, send, confirmation }
}

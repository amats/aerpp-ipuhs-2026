"use server"

import { createHash, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { env } from "@aerpp/config/server/admin"
import { readDocumentFont, renderDocumentPdf } from "@aerpp/documents/pdf"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import {
  deriveParticipantDocumentId,
  deriveParticipantPseudonym,
  formatParticipantDocumentDate,
} from "@aerpp/participant-api-contracts/identifiers"
import { DocumentSetReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"
import { FieldValue } from "@google-cloud/firestore"
import { z } from "zod"
import { decryptExportEmail } from "@/features/research/export-email"
import { requireAdminSession } from "@/lib/auth"
import { firestore } from "@/lib/firestore"
import { logDocumentReissueFailure } from "@/lib/logger"
import { dateMillis } from "@/lib/record-time"
import { loadDocumentOriginal } from "./document-archive"

export async function reissueParticipantDocumentAction(value: unknown) {
  const session = await requireAdminSession("/participant")
  const parsed = z
    .object({
      pseudonym: z.string().regex(/^aerpp:pid-[a-f0-9]{32}$/),
      recordId: z
        .string()
        .min(1)
        .max(256)
        .refine(
          (value) =>
            !value.includes("/") &&
            value !== "." &&
            value !== ".." &&
            !/^__.*__$/.test(value),
        ),
      name: z.enum(["receipt", "explanation", "plan"]),
    })
    .strict()
    .safeParse(value)
  if (parsed.success !== true || !session.user?.email)
    return { ok: false as const, error: "対象のPIDと記録を確認してください。" }
  let receipt:
    | ReturnType<ReturnType<typeof createParticipantRepository>["accessEvent"]>
    | undefined
  let generated = false
  try {
    const repository = createParticipantRepository(firestore)
    const input = parsed.data
    const record = (
      await repository.participationEvent(input.recordId).get()
    ).data()
    if (
      !record ||
      record.pseudonym !== input.pseudonym ||
      (env.participantApiServerId !== "all" &&
        record.serverId !== env.participantApiServerId) ||
      (record.eventType !== "consent" && record.eventType !== "withdrawal")
    )
      throw new Error("Document record unavailable")
    const reference = DocumentSetReferenceSchema.parse(record.documentSet)
    const timestamp = dateMillis(
      record[
        record.eventType === "consent"
          ? "consentConfirmedAt"
          : "withdrawalAcceptedAt"
      ],
    )
    if (timestamp === null) throw new Error("Document date unavailable")
    const actorId = createHash("sha256")
      .update(session.user.email.trim().toLowerCase())
      .digest("hex")
    const name =
      input.name === "receipt"
        ? (record.eventType as "consent" | "withdrawal")
        : input.name
    receipt = repository.accessEvent(randomUUID())
    await receipt.create({
      schemaVersion: 1,
      eventType: "document_reissue",
      pseudonym: input.pseudonym,
      serverId: record.serverId,
      consentId: record.consentId ?? input.recordId,
      actorId,
      recordId: input.recordId,
      documentSet: reference,
      reasonCode: name,
      dataPurpose: record.dataPurpose ?? "unclassified",
      outcome: "requested",
      recordedAt: FieldValue.serverTimestamp(),
    })
    const [template, font] = await Promise.all([
      loadDocumentOriginal(reference, `${name}.pdf`),
      readDocumentFont(
        resolve(/*turbopackIgnore: true*/ process.cwd(), "../.."),
      ),
    ])
    let participant:
      | { email: string; date: string; documentId: string }
      | undefined
    if (name === "consent" || name === "withdrawal") {
      const email = await decryptExportEmail(
        record.encryptedEmail,
        env.sessionSealPassword,
      )
      if (
        deriveParticipantPseudonym(email, env.identifierHashSecret) !==
        input.pseudonym
      )
        throw new Error("Document email conflicts")
      const date = formatParticipantDocumentDate(new Date(timestamp))
      participant = {
        email,
        date,
        documentId: deriveParticipantDocumentId(
          email,
          date,
          name,
          env.identifierHashSecret,
          reference.sha256,
        ),
      }
    }
    const bytes = await renderDocumentPdf(
      template,
      font,
      reference,
      participant,
    )
    generated = true
    // Generated means the server prepared a copy, never proof of participant delivery.
    await receipt.update({
      outcome: "generated",
      outcomeReceivedAt: FieldValue.serverTimestamp(),
    })
    return {
      ok: true as const,
      contentBase64: Buffer.from(bytes).toString("base64"),
      filename: `AERPP-${name}-${input.recordId}.pdf`,
    }
  } catch (error) {
    if (receipt && generated !== true) {
      try {
        await receipt.update({
          outcome: "failed",
          outcomeReceivedAt: FieldValue.serverTimestamp(),
        })
      } catch {
        /* An unconfirmed audit attempt remains visible as requested. */
      }
    }
    logDocumentReissueFailure(error)
    return {
      ok: false as const,
      error:
        "書類を再発行できませんでした。参加記録は変更していません。時間をおいて再試行するか、参加アプリからのダウンロードをご利用ください。続く場合は原本・受付記録・対象環境を確認してください。",
    }
  }
}

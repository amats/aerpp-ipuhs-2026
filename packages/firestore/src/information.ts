import {
  InformationInputSchema,
  type InformationMutationResult,
  type InformationRecord,
  InformationRecordSchema,
  InformationTargetSchema,
} from "@aerpp/firestore/information-types"
import { firestoreTimestampToIso } from "@aerpp/firestore/values"
import {
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  Timestamp,
} from "@google-cloud/firestore"

// The caller owns authentication, environment selection and logging.
export function createInformationRepository(database: Firestore) {
  const collection = database.collection("information")
  return {
    async listMessages() {
      const snapshot = await collection.get()
      return snapshot.docs.map((doc) => {
        readRecord(doc)
        return { ...doc.data(), id: doc.id }
      })
    },
    async list(): Promise<InformationRecord[]> {
      const snapshot = await collection.get()
      return snapshot.docs
        .map(readRecord)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
        )
    },
    async add(input: unknown) {
      const data = InformationInputSchema.parse(input)
      const ref = await collection.add({
        ...data,
        tone: data.tone ?? "info",
        expireAt: Timestamp.fromDate(new Date(data.expireAt)),
        createdAt: FieldValue.serverTimestamp(),
      })
      return ref.id
    },
    async update(
      target: unknown,
      input: unknown,
    ): Promise<InformationMutationResult> {
      const parsedTarget = InformationTargetSchema.parse(target)
      const data = InformationInputSchema.parse(input)
      return mutate(parsedTarget, {
        ...data,
        tone: data.tone ?? "info",
        expireAt: Timestamp.fromDate(new Date(data.expireAt)),
      })
    },
    async remove(target: unknown): Promise<InformationMutationResult> {
      return mutate(InformationTargetSchema.parse(target))
    },
  }

  async function mutate(
    target: ReturnType<typeof InformationTargetSchema.parse>,
    data?: Record<string, unknown>,
  ): Promise<InformationMutationResult> {
    const ref = collection.doc(target.id)
    return database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return { ok: false, code: "not_found" }
      if (
        !snapshot.updateTime?.isEqual(
          new Timestamp(target.version.seconds, target.version.nanoseconds),
        )
      )
        return { ok: false, code: "conflict" }
      if (data) transaction.update(ref, data)
      else transaction.delete(ref)
      return { ok: true }
    })
  }
}

function readRecord(doc: QueryDocumentSnapshot): InformationRecord {
  const data = doc.data()
  const version = doc.updateTime
  return InformationRecordSchema.parse({
    id: doc.id,
    version: {
      seconds: version.seconds,
      nanoseconds: version.nanoseconds,
    },
    content: data.content,
    tone: data.tone,
    expireAt: firestoreTimestampToIso(data.expireAt),
    createdAt: firestoreTimestampToIso(data.createdAt),
  })
}

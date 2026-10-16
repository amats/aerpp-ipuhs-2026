import { AsyncLocalStorage } from "node:async_hooks"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import type { Firestore } from "@google-cloud/firestore"

export type { Transaction } from "@google-cloud/firestore"
export { FieldValue, Timestamp } from "@google-cloud/firestore"

const databaseContext = new AsyncLocalStorage<Firestore>()
export function withDatabase<T>(database: Firestore, operation: () => T): T {
  return databaseContext.run(database, operation)
}
export function getFirestore(): Firestore {
  const database = databaseContext.getStore()
  if (!database) throw new Error("Support database context missing")
  return database
}

export function getParticipantRepository() {
  return createParticipantRepository(getFirestore())
}

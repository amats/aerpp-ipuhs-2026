import "server-only"

import { readParticipantResearchSnapshot } from "@aerpp/firestore/participant-snapshot"
import { awaitRead } from "@/lib/await-read"
import { firestore } from "@/lib/firestore"
import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"

export async function readResearchSource(
  includeAccess = false,
  {
    signal,
    retain,
  }: {
    signal?: AbortSignal
    retain?: (pending: Promise<unknown>) => void
  } = {},
) {
  if (signal === undefined)
    return readParticipantResearchSnapshot(firestore, { includeAccess })
  signal.throwIfAborted()
  const snapshot = readParticipantResearchSnapshot(firestore, {
    includeAccess,
    signal,
    limits: {
      maxRecords: limits.maxRecords,
      maxBytes: limits.maxSourceBytes,
      pageSize: limits.pageSize,
    },
  })
  retain?.(snapshot)
  return awaitRead(snapshot, signal)
}

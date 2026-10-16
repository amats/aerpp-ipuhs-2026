import "server-only"

import { env } from "@aerpp/config/server/admin"
import {
  type DataPurposeFilter,
  matchesDataPurpose,
  normalizeDataPurpose,
} from "@aerpp/firestore/data-purpose-types"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { firestore } from "@/lib/firestore"
import { dateMillis } from "@/lib/record-time"

export async function loadRecoveryAuthorizations(purpose: DataPurposeFilter) {
  const snapshot = await createParticipantRepository(firestore)
    .participationEvents()
    .where("eventType", "==", "recovery_authorized")
    .select(
      "pseudonym",
      "serverId",
      "dataPurpose",
      "questionnaireKind",
      "destination",
      "analysisId",
      "supersededBy",
      "reason",
      "actorId",
      "authorizedAt",
      "consumedAt",
    )
    .get()
  return snapshot.docs
    .flatMap((doc) => {
      const data = doc.data()
      if (
        (env.participantApiServerId !== "all" &&
          data.serverId !== env.participantApiServerId) ||
        matchesDataPurpose(normalizeDataPurpose(data.dataPurpose), purpose) !==
          true
      )
        return []
      return [
        {
          id: doc.id,
          pseudonym: String(data.pseudonym ?? ""),
          kind: String(data.questionnaireKind ?? ""),
          destination: String(data.destination ?? ""),
          analysisId: String(data.analysisId ?? ""),
          supersededBy: String(data.supersededBy ?? ""),
          reason: String(data.reason ?? ""),
          actorId: String(data.actorId ?? ""),
          authorizedAt: dateMillis(data.authorizedAt),
          consumedAt: dateMillis(data.consumedAt),
        },
      ]
    })
    .sort((a, b) => (b.authorizedAt ?? 0) - (a.authorizedAt ?? 0))
    .slice(0, 200)
}

import type { ResearchSource, SourceDocument } from "./research-types"

// Evaluate the original participation boundary in the same export snapshot.
// Renewed participation never reopens an already closed boundary.
export function eligibleResearchSource(source: ResearchSource): ResearchSource {
  const consents = new Map<unknown, Record<string, unknown>>(
    source.participationEvents
      .filter(({ data }) => data.eventType === "consent")
      .map(({ id, data }) => [data.consentId ?? id, data]),
  )
  const closures = new Map<string, Set<unknown>>()
  for (const { data } of source.participationEvents) {
    if (data.eventType !== "withdrawal") continue
    if (typeof data.pseudonym !== "string")
      throw new Error("Withdrawal ownership unresolved")
    const consent = consents.get(data.consentId)
    let boundary: unknown
    if (Object.hasOwn(data, "consentBoundaryId"))
      boundary = data.consentBoundaryId
    else if (consent?.pseudonym === data.pseudonym)
      boundary = consent.precedingWithdrawalId ?? null
    else throw new Error("Withdrawal boundary unresolved")
    const closed = closures.get(data.pseudonym) ?? new Set()
    closed.add(boundary)
    closures.set(data.pseudonym, closed)
  }
  for (const { data } of source.participationStates) {
    if (data.status === "withdrawn") {
      if (typeof data.pseudonym !== "string" || !closures.has(data.pseudonym))
        throw new Error("Withdrawal history unresolved")
      if (
        Object.hasOwn(data, "consentBoundaryId") &&
        !closures.get(data.pseudonym)?.has(data.consentBoundaryId)
      )
        throw new Error("Withdrawal state boundary conflicts with history")
    }
  }
  const eligible = ({ data }: SourceDocument) => {
    if (closures.size > 0 && typeof data.pseudonym !== "string")
      throw new Error("Research ownership unresolved")
    const closed = closures.get(String(data.pseudonym))
    if (!closed) return true
    const consent = consents.get(data.consentId)
    const boundary = Object.hasOwn(data, "consentBoundaryId")
      ? data.consentBoundaryId
      : consent && consent.pseudonym === data.pseudonym
        ? (consent.precedingWithdrawalId ?? null)
        : undefined
    if (
      boundary === undefined ||
      (consent &&
        (consent.pseudonym !== data.pseudonym ||
          (consent.precedingWithdrawalId ?? null) !== boundary))
    )
      throw new Error("Research participation boundary unresolved")
    return !closed.has(boundary)
  }
  return {
    ...source,
    analysisQuestionnaires: source.analysisQuestionnaires.filter(eligible),
    attempts: source.attempts.filter(eligible),
  }
}

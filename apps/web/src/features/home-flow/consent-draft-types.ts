export type ConsentChecks = {
  understoodRisk: boolean
  understoodWithdraw: boolean
  agreeDataUsage: boolean
  agreeParticipation: boolean
}

export type ConsentDraft = {
  email: string
  checks: ConsentChecks
}

export const EMPTY_CONSENT_DRAFT: ConsentDraft = {
  email: "",
  checks: {
    understoodRisk: false,
    understoodWithdraw: false,
    agreeDataUsage: false,
    agreeParticipation: false,
  },
}

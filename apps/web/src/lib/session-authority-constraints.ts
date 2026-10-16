// Ten concurrent participants have room for admission/recovery retries. These
// limits bound retained metadata; active sessions and tombstones are not evicted.
export const SESSION_AUTHORITY_CONSTRAINTS = {
  maxRecords: 10000,
  recoveryReserve: 1000,
  admissionBurst: 120,
  admissionPerMinute: 60,
  recoveryBurst: 60,
  recoveryPerMinute: 30,
} as const

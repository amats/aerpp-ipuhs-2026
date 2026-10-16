export const ANALYSIS_JOB_CONSTRAINTS = {
  maxDurationMs: 15 * 60 * 1000,
  resultRetentionMs: 10 * 60 * 1000,
  maxJobs: 20,
  maxResponseBytes: 2 * 1024 * 1024,
  maxResultBytes: 128 * 1024,
  pollIntervalMs: 2000,
  startRequestTimeoutMs: 90_000,
  requestTimeoutMs: 15_000,
} as const

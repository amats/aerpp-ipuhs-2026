export const EXPORT_CONSTRAINTS = {
  readTimeoutMs: 90_000,
  requestTimeoutMs: 110_000,
  maxConcurrent: 1,
  maxRecords: 20_000,
  maxSourceBytes: 16 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxCsvCells: 1_000_000,
  pageSize: 32,
} as const

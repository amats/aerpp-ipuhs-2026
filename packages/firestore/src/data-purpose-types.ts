export type DataPurpose = "research" | "test" | "unclassified"
export type DataPurposeFilter = DataPurpose | "all"

export const DATA_PURPOSE_LABELS = {
  research: "実データ",
  test: "テスト",
  unclassified: "未分類",
  all: "すべて",
}

export function normalizeDataPurpose(value: unknown): DataPurpose {
  return value === "research" || value === "test" ? value : "unclassified"
}

export function resolveDataPurposeFilter(value: unknown): DataPurposeFilter {
  return value === "all" || value === "test" || value === "unclassified"
    ? value
    : "research"
}

export function matchesDataPurpose(value: unknown, filter: DataPurposeFilter) {
  return filter === "all" || normalizeDataPurpose(value) === filter
}

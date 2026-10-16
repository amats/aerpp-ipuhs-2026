import type { AnalysisTimeDistribution } from "./analysis-time-distribution-types"

const MAX_HISTOGRAM_BINS = 200

function quartile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const weight = position - lower
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * weight
}

export function buildAnalysisTimeDistribution(
  times: readonly (number | null)[],
): AnalysisTimeDistribution {
  const sorted = times
    .filter(
      (time): time is number =>
        time !== null && Number.isFinite(time) && time >= 0,
    )
    .sort((left, right) => left - right)
  const validCount = sorted.length
  const unknownCount = times.length - validCount
  if (validCount === 0) {
    return { bins: [], validCount, unknownCount, method: "none" }
  }

  const min = sorted[0]
  const max = sorted[validCount - 1]
  if (min === max) {
    return {
      bins: [{ lowerSec: min, upperSec: max, count: validCount }],
      validCount,
      unknownCount,
      method: "single",
    }
  }

  const range = max - min
  const iqr = quartile(sorted, 0.75) - quartile(sorted, 0.25)
  const estimatedWidth = (iqr / Math.cbrt(validCount)) * 2
  const estimatedBins = Math.ceil(range / estimatedWidth)
  // Fall back to a standard rule if FD is undefined or impractical to render.
  const useFd =
    Number.isFinite(estimatedBins) &&
    estimatedBins > 0 &&
    estimatedBins <= MAX_HISTOGRAM_BINS
  const binCount = useFd ? estimatedBins : Math.ceil(Math.log2(validCount) + 1)
  const edges = Array.from({ length: binCount + 1 }, (_, index) =>
    index === binCount ? max : min + range * (index / binCount),
  )
  const bins = edges.slice(0, -1).map((lowerSec, index) => ({
    lowerSec,
    upperSec: edges[index + 1],
    count: 0,
  }))

  for (const time of sorted) {
    // Bins are [lower, upper), except that the final bin includes the maximum.
    let lower = 0
    let upper = binCount - 1
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2)
      if (time >= edges[middle]) lower = middle
      else upper = middle - 1
    }
    bins[lower].count += 1
  }

  return {
    bins,
    validCount,
    unknownCount,
    method: useFd ? "freedman-diaconis" : "sturges",
  }
}

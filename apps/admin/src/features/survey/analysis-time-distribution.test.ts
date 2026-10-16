import { describe, expect, it } from "vitest"
import { buildAnalysisTimeDistribution } from "./analysis-time-distribution"

describe("analysis time distribution", () => {
  it("uses linear quartiles and FD bins across the complete range", () => {
    // Q1 = 1.75, Q3 = 5.25, h = 3.5: ceil(9 / 3.5) = 3 bins.
    const result = buildAnalysisTimeDistribution([9, 0, 6, 1, 5, 2, 4, 3])
    expect(result).toEqual({
      method: "freedman-diaconis",
      validCount: 8,
      unknownCount: 0,
      bins: [
        { lowerSec: 0, upperSec: 3, count: 3 },
        { lowerSec: 3, upperSec: 6, count: 3 },
        { lowerSec: 6, upperSec: 9, count: 2 },
      ],
    })
  })

  it("retains empty intervals and the maximum when IQR is zero", () => {
    const result = buildAnalysisTimeDistribution([0, 0, 0, 0, 0, 0, 0, 8])
    expect(result.method).toBe("sturges")
    expect(result.bins).toEqual([
      { lowerSec: 0, upperSec: 2, count: 7 },
      { lowerSec: 2, upperSec: 4, count: 0 },
      { lowerSec: 4, upperSec: 6, count: 0 },
      { lowerSec: 6, upperSec: 8, count: 1 },
    ])
  })

  it.each([{ times: [0] }, { times: [30, 30, 30] }])(
    "shows identical values in one bin: $times",
    ({ times }) => {
      expect(buildAnalysisTimeDistribution(times)).toEqual({
        method: "single",
        validCount: times.length,
        unknownCount: 0,
        bins: [{ lowerSec: times[0], upperSec: times[0], count: times.length }],
      })
    },
  )

  it("counts invalid values separately without excluding zero or fractional seconds", () => {
    const result = buildAnalysisTimeDistribution([
      null,
      -1,
      Number.NaN,
      Infinity,
      -Infinity,
      0,
      0.5,
      1,
    ])
    expect(result.validCount).toBe(3)
    expect(result.unknownCount).toBe(5)
    expect(result.bins.reduce((count, bin) => count + bin.count, 0)).toBe(3)
    expect(result.bins[0].lowerSec).toBe(0)
    expect(result.bins.at(-1)?.upperSec).toBe(1)
  })

  it.each([{ times: [] }, { times: [null, -10] }])(
    "handles no usable times: $times",
    ({ times }) => {
      expect(buildAnalysisTimeDistribution(times)).toEqual({
        method: "none",
        bins: [],
        validCount: 0,
        unknownCount: times.length,
      })
    },
  )

  it("uses Sturges for excessive FD bins while retaining the outlier", () => {
    const result = buildAnalysisTimeDistribution([0, 1, 2, 3, 4, 5, 6, 10000])
    expect(result.method).toBe("sturges")
    expect(result.bins).toHaveLength(4)
    expect(result.bins.map((bin) => bin.count)).toEqual([7, 0, 0, 1])
    expect(result.bins.at(-1)?.upperSec).toBe(10000)
  })

  it("keeps every observation exactly once without changing the input", () => {
    const times = Object.freeze(
      Array.from({ length: 300 }, (_, index) => (index % 17) / 10),
    )
    const result = buildAnalysisTimeDistribution(times)
    expect(result.bins.reduce((count, bin) => count + bin.count, 0)).toBe(
      times.length,
    )
    for (const [index, bin] of result.bins.entries()) {
      const isLast = index === result.bins.length - 1
      expect(bin.count).toBe(
        times.filter(
          (time) =>
            time >= bin.lowerSec &&
            (isLast ? time <= bin.upperSec : time < bin.upperSec),
        ).length,
      )
    }
  })
})

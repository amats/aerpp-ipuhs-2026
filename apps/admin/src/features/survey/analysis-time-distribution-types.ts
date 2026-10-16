export type AnalysisTimeBin = {
  lowerSec: number
  upperSec: number
  count: number
}

export type AnalysisTimeDistribution = {
  bins: AnalysisTimeBin[]
  validCount: number
  unknownCount: number
  method: "freedman-diaconis" | "sturges" | "single" | "none"
}

"use client"

import { useEffect, useState } from "react"

type DebugStorageSnapshot =
  | { status: "loading" | "unavailable" }
  | { status: "available"; values: Record<string, string | null> }

export function useDebugStorageSnapshot(
  readValues: () => Record<string, string | null>,
): DebugStorageSnapshot {
  const [snapshot, setSnapshot] = useState<DebugStorageSnapshot>({
    status: "loading",
  })
  useEffect(() => {
    try {
      setSnapshot({ status: "available", values: readValues() })
    } catch {
      setSnapshot({ status: "unavailable" })
    }
  }, [readValues])
  return snapshot
}

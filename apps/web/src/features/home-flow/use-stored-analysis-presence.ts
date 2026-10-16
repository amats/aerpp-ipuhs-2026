"use client"

import { useEffect, useState } from "react"
import { subscribeBrowserState } from "@/lib/browser-database"
import { readBrowserAnalysisPresence } from "@/lib/browser-session"

type StoredPresence = "present" | "absent" | "unavailable"
type StoredAnalysisPresence = {
  analysisResult: StoredPresence
  recoveredSurvey: StoredPresence
}
const UNAVAILABLE: StoredAnalysisPresence = {
  analysisResult: "unavailable",
  recoveredSurvey: "unavailable",
}

export function useStoredAnalysisPresence() {
  const [presence, setPresence] = useState(UNAVAILABLE)
  useEffect(() => {
    let generation = 0
    const refresh = () => {
      const current = ++generation
      void readBrowserAnalysisPresence()
        .then((snapshot) => {
          if (current === generation)
            setPresence({
              analysisResult:
                snapshot.analysisResult === true ? "present" : "absent",
              recoveredSurvey:
                snapshot.recoveredSurvey === true ? "present" : "absent",
            })
        })
        .catch(() => {
          if (current === generation) setPresence(UNAVAILABLE)
        })
    }
    const unsubscribe = subscribeBrowserState(refresh)
    refresh()
    return () => {
      generation += 1
      unsubscribe()
    }
  }, [])
  return presence
}

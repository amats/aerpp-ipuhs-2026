"use client"

import {
  changeBrowserState,
  emptyBrowserPayload,
  readCachedBrowserSession,
} from "./browser-database"
import type {
  BrowserAnalysisSnapshot,
  BrowserPayloadKey,
  BrowserPayloadSnapshot,
  BrowserReset,
  BrowserState,
} from "./browser-state-types"
import { createTabId } from "./session-generation"

function requireCurrent(state: BrowserState, scope?: string) {
  if (state.reset || (scope !== undefined && state.scope !== scope))
    throw new Error("Browser session changed")
}

export function getBrowserSession() {
  return changeBrowserState((state) => {
    requireCurrent(state)
    return { value: state.scope, changed: false }
  })
}

// This synchronous cache supports cancellation, never storage authorization.
// Each commitment checks the actual generation in its IndexedDB transaction.
export function isBrowserSessionCurrent(scope: string) {
  const state = readCachedBrowserSession()
  return state?.scope === scope && state.reset === null
}

export function readBrowserRecoveryRevision() {
  return readCachedBrowserSession()?.recoveryRevision ?? 0
}

// Only an accepted administrator reset receipt authorizes discarding every old
// payload. Its revision also fences old private contexts and repeated cleanup.
export function clearBrowserForAdminRecovery(scope: string, revision: number) {
  return changeBrowserState((state) => {
    if (
      state.reset ||
      state.scope !== scope ||
      (state.contexts[scope]?.revision ?? -1) > revision
    )
      return { value: false, changed: false }
    if ((state.recoveryRevision ?? 0) >= revision)
      return { value: state.recoveryRevision === revision, changed: false }
    state.contexts = { [scope]: { revision, value: null } }
    state.analysisResult = emptyBrowserPayload()
    state.recoveredSurvey = emptyBrowserPayload()
    state.recoveryRevision = revision
    return { value: true, changed: true }
  })
}

export function commitBrowserAdmission(
  previousScope: string,
  scope: string,
  recovered: boolean,
) {
  return changeBrowserState((state) => {
    requireCurrent(state, previousScope)
    const changed = recovered === true || state.scope !== scope
    if (recovered === true) {
      delete state.recoveryRevision
      state.contexts = {}
      state.analysisResult = emptyBrowserPayload()
      state.recoveredSurvey = emptyBrowserPayload()
    }
    if (state.scope !== scope) delete state.recoveryRevision
    state.scope = scope
    return { value: true, changed }
  })
}

export function commitSessionBrowserContext(
  scope: string,
  revision: number,
  value: string | null,
) {
  return changeBrowserState((state) => {
    if (
      state.reset ||
      state.scope !== scope ||
      (state.contexts[scope]?.revision ?? -1) > revision
    )
      return { value: false, changed: false }
    state.contexts[scope] = { revision, value }
    return { value: true, changed: true }
  })
}

export function readBrowserPayload(
  key: BrowserPayloadKey,
): Promise<BrowserPayloadSnapshot> {
  const scope = readCachedBrowserSession()?.scope
  return changeBrowserState((state) => {
    requireCurrent(state, scope)
    return { value: { scope: state.scope, ...state[key] }, changed: false }
  })
}

// Inspect both cleanup targets in the same snapshot. This is display information,
// never authorization to delete; cleanup still compares its captured versions.
export function readBrowserAnalysisPresence() {
  const scope = readCachedBrowserSession()?.scope
  return changeBrowserState((state) => {
    requireCurrent(state, scope)
    return {
      value: {
        analysisResult: state.analysisResult.value !== null,
        recoveredSurvey: state.recoveredSurvey.value !== null,
      },
      changed: false,
    }
  })
}

export function replaceBrowserPayload(
  key: BrowserPayloadKey,
  expected: BrowserPayloadSnapshot,
  value: string | null,
) {
  return changeBrowserState((state) => {
    if (
      state.reset ||
      state.scope !== expected.scope ||
      state[key].version !== expected.version
    )
      return { value: false, changed: false }
    state[key] = { version: createTabId(), value }
    return { value: true, changed: true }
  })
}

export function isBrowserPayloadCurrent(
  key: BrowserPayloadKey,
  expected: BrowserPayloadSnapshot,
) {
  return changeBrowserState((state) => ({
    value:
      state.reset === null &&
      state.scope === expected.scope &&
      state[key].version === expected.version,
    changed: false,
  }))
}

// Capture before a server transition; late cleanup must not delete data saved
// after that transition by another tab. Both payloads are removed atomically.
export function captureBrowserAnalysis(): Promise<BrowserAnalysisSnapshot | null> {
  const scope = readCachedBrowserSession()?.scope
  return changeBrowserState((state) => {
    requireCurrent(state, scope)
    return {
      value: {
        scope: state.scope,
        analysisResultVersion: state.analysisResult.version,
        recoveredSurveyVersion: state.recoveredSurvey.version,
      },
      changed: false,
    }
  }).catch(() => null)
}

export async function clearBrowserAnalysis(
  expected: BrowserAnalysisSnapshot | null,
) {
  if (expected === null) return false
  try {
    return await changeBrowserState((state) => {
      if (state.reset || state.scope !== expected.scope)
        return { value: false, changed: false }
      // Retrying an acknowledged or ambiguous deletion is safe while both
      // slots are empty. Any new payload still requires the captured versions.
      if (
        state.analysisResult.value === null &&
        state.recoveredSurvey.value === null
      )
        return { value: true, changed: false }
      if (
        state.analysisResult.version !== expected.analysisResultVersion ||
        state.recoveredSurvey.version !== expected.recoveredSurveyVersion
      )
        return { value: false, changed: false }
      state.analysisResult = emptyBrowserPayload()
      state.recoveredSurvey = emptyBrowserPayload()
      return { value: true, changed: true }
    })
  } catch {
    return false
  }
}

export function beginBrowserReset(expectedScope?: string) {
  return changeBrowserState((state) => {
    if (expectedScope !== undefined) requireCurrent(state, expectedScope)
    const target = {
      scope: state.scope,
      previousScope: state.scope,
      attempt: createTabId(),
      replacementScope: createTabId(),
    }
    state.reset = target
    return { value: target, changed: true }
  })
}

function ownsReset(state: BrowserState, target: BrowserReset) {
  return (
    state.reset?.attempt === target.attempt &&
    state.scope === target.previousScope
  )
}

export function isBrowserResetCurrent(target: BrowserReset) {
  return changeBrowserState((state) => ({
    value: ownsReset(state, target),
    changed: false,
  }))
}

export function finishBrowserReset(target: BrowserReset) {
  return changeBrowserState((state) => {
    if (ownsReset(state, target) !== true)
      return { value: false, changed: false }
    state.scope = target.replacementScope
    delete state.recoveryRevision
    state.contexts = {}
    state.analysisResult = emptyBrowserPayload()
    state.recoveredSurvey = emptyBrowserPayload()
    state.reset = null
    return { value: true, changed: true }
  })
}

export function cancelBrowserReset(target: BrowserReset) {
  return changeBrowserState((state) => {
    if (ownsReset(state, target) !== true)
      return { value: undefined, changed: false }
    state.reset = null
    return { value: undefined, changed: true }
  })
}

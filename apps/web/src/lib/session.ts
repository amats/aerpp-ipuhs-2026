import "server-only"

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { env } from "@aerpp/config/server/web"
import {
  type IronSession,
  type SessionOptions,
  sealData,
  unsealData,
} from "iron-session"
import { cookies } from "next/headers"
import { assertReceptionOpen } from "./reception"
import {
  type AuthorityRecord,
  createAuthority,
  readAuthority,
  revokeAuthority,
  sessionOperation,
  setAnalysisOperation,
  updateAuthority,
} from "./session-authority"
import {
  type SessionData,
  sessionPrivateSchema,
  sessionStateSchema,
  splitSessionData,
} from "./session-data"
import {
  isSessionGeneration,
  readTabGeneration,
  SESSION_COOKIE_PREFIX,
  sessionCookieName,
} from "./session-generation"
import { hashSessionState } from "./session-state-hash"

export type { SessionData } from "./session-data"

// Browser retention is finite; it is renewed on admission, independently of
// authentication and reception. Browser deletion still requires authentication.
const COOKIE_RETENTION_SECONDS = 400 * 24 * 60 * 60

/*
 * Session handling rules:
 * - Cookies hold only an opaque random credential; SQLite owns allowlisted state.
 * - Sealed email/retry context stays in browser storage and transient request memory.
 * - Content/answers are forbidden in SQLite. Intro and result/survey views do not save.
 * - Atomic revision checks and operation fencing reject stale server writes.
 * - Treat cookie-backed values as external input.
 * - Read session values through owning read...FromSession(session) helpers that
 *   validate before returning application data.
 * - Prefer passing already-validated values when a function only needs to read.
 * - Passing AppSession implies the callee may mutate it.
 * - For mutation flows, call session.save() only after the operation has
 *   succeeded and log get/save failures at the caller boundary.
 */

// ttl=0 disables application expiration for browser-only seals.
export function getSessionOptions(): SessionOptions {
  return createSessionOptions(COOKIE_RETENTION_SECONDS)
}

function createSessionOptions(maxAge: number): SessionOptions {
  const cookieOptions: SessionOptions["cookieOptions"] = {
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge,
  }

  return {
    cookieName: "aerpp-session",
    chunk: false,
    ttl: 0,
    password: {
      // Sealing key ID stays 1; the environment rename does not rotate the key.
      1: env.sessionSealPassword,
    },
    cookieOptions,
  }
}

type SessionSaveOptions = { startAnalysisId: string }
export type AppSession = Omit<IronSession<SessionData>, "save"> & {
  save(options?: SessionSaveOptions): Promise<void>
}

const sessionSnapshots = new WeakMap<
  AppSession,
  { revision: number; hash: string }
>()

export function isSessionSnapshotCurrent(
  session: AppSession,
  authority: AuthorityRecord,
) {
  const snapshot = sessionSnapshots.get(session)
  return (
    snapshot?.revision === authority.revision &&
    snapshot.hash === authority.hash
  )
}

// Explicit force recovery keeps a tombstone so old cookies cannot recreate
// authentication. It deliberately does not acquire an ordinary operation permit.
export async function revokeSession(id: string) {
  if (!isSessionGeneration(id)) throw new Error("Invalid session generation")
  // A content-free fence prevents delayed admission from reusing this ID.
  revokeAuthority(id, credentialHash(randomUUID()))
}

function credentialHash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
function matchesCredential(
  value: string | undefined,
  authority: AuthorityRecord,
) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value) || !authority.credentialHash)
    return false
  const actual = Buffer.from(credentialHash(value), "hex")
  const expected = Buffer.from(authority.credentialHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function readStoredState(authority: AuthorityRecord) {
  try {
    if (!authority.state) throw new Error("missing state")
    const state = sessionStateSchema.parse(JSON.parse(authority.state))
    if (
      state.coordinationId !== authority.id ||
      state.serverId !== env.participantApiServerId ||
      hashSessionState(state) !== authority.hash
    )
      throw new Error("invalid state")
    return state
  } catch {
    throw new Error("session_invalid")
  }
}
async function readBrowserContext(
  id: string,
  value: string | null | undefined,
  options: SessionOptions,
  state: SessionData,
) {
  if (!value) return sessionPrivateSchema.parse({})
  try {
    if (value.length > 32_768) throw new Error("invalid context")
    const sealed = await unsealData<{
      purpose: string
      id: string
      identity: Record<string, unknown>
      data: unknown
    }>(value, options)
    if (sealed.purpose !== "session-private" || sealed.id !== id)
      throw new Error("invalid context")
    if (
      Object.entries(browserContextIdentity(state)).some(
        ([key, value]) => sealed.identity?.[key] !== value,
      )
    ) {
      // An explicit pre-auth correction may have cleared/replaced this identity
      // before its response arrived. No prior private context can authorize it.
      if (state.stage === "unauthenticated")
        return sessionPrivateSchema.parse({})
      throw new Error("context identity mismatch")
    }
    return sessionPrivateSchema.parse(sealed.data)
  } catch {
    throw new Error("browser_context_invalid")
  }
}
function browserContextIdentity(state: SessionData) {
  return {
    serverId: state.serverId,
    clientId: state.clientId,
    pseudonym: state.pseudonym,
    consentId: state.consentId,
  }
}
async function readUniqueGeneration(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
) {
  let selected: string | undefined
  for (const cookie of cookieStore.getAll()) {
    if (!cookie.name.startsWith(SESSION_COOKIE_PREFIX)) continue
    const id = cookie.name.slice(SESSION_COOKIE_PREFIX.length)
    if (!isSessionGeneration(id)) continue
    const authority = readAuthority(id)
    if (!authority || matchesCredential(cookie.value, authority) !== true)
      continue
    if (selected) throw new Error("Session selection required")
    selected = id
  }
  return selected
}
export async function getSessionForTab(token: unknown) {
  const scope = readTabGeneration(token)
  if (!scope) throw new Error("session_invalid")
  const session = await getSession(
    scope,
    typeof token === "string" ? token.split(":")[2] : undefined,
  )
  const expected = typeof token === "string" ? token.split(":")[1] : ""
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    readAuthority(scope)?.hash !== expected
  )
    throw new Error("stale_session_state")
  return session
}
export function getSessionToken(id: string) {
  const authority = readAuthority(id)
  if (!authority) throw new Error("session_invalid")
  return `${id}:${authority.hash}`
}
export async function pruneSessionCookies(active: string) {
  const cookieStore = await cookies()
  for (const cookie of cookieStore.getAll()) {
    if (!cookie.name.startsWith(SESSION_COOKIE_PREFIX)) continue
    const id = cookie.name.slice(SESSION_COOKIE_PREFIX.length)
    const authority = isSessionGeneration(id) ? readAuthority(id) : null
    if (
      id !== active &&
      (!authority || matchesCredential(cookie.value, authority) !== true)
    )
      cookieStore.delete(cookie.name)
  }
}

export async function renewSessionCookie(id: string) {
  const store = await cookies()
  const credential = store.get(sessionCookieName(id))?.value
  const authority = readAuthority(id)
  if (
    !credential ||
    !authority ||
    matchesCredential(credential, authority) !== true
  )
    throw new Error("session_invalid")
  store.set(
    sessionCookieName(id),
    credential,
    getSessionOptions().cookieOptions,
  )
}
export async function getSession(
  scope?: string,
  browserContext?: string | null,
): Promise<AppSession> {
  const operation = sessionOperation.getStore()
  if (scope && operation && scope !== operation.id)
    throw new Error("Session generation mismatch")
  const cookieStore = await cookies()
  const options = getSessionOptions()
  const selected =
    scope ?? operation?.id ?? (await readUniqueGeneration(cookieStore))
  if (selected !== undefined && !isSessionGeneration(selected))
    throw new Error("Invalid session generation")
  let id = selected
  let revision = 0
  let expectedHash: string | undefined
  let data: SessionData = {}
  const authority = id ? readAuthority(id) : null
  if (id && authority) {
    if (
      matchesCredential(
        cookieStore.get(sessionCookieName(id))?.value,
        authority,
      ) !== true
    )
      throw new Error("session_snapshot_unavailable")
    const state = readStoredState(authority)
    data = {
      ...state,
      ...(await readBrowserContext(
        id,
        browserContext ?? operation?.browserContext,
        options,
        state,
      )),
    }
    revision = authority.revision
    expectedHash = authority.hash
    if (
      operation &&
      operation.readOnly !== true &&
      authority.busy !== operation.operationId
    )
      throw new Error("Superseded operation")
  } else if (id && cookieStore.get(sessionCookieName(id)))
    throw new Error("session_invalid")
  let priorPrivate = JSON.stringify(splitSessionData(data).privateState)
  const session = { ...data } as AppSession
  if (expectedHash)
    sessionSnapshots.set(session, { revision, hash: expectedHash })
  Object.defineProperties(session, {
    destroy: {
      value: () => {
        if (sessionOperation.getStore()?.readOnly === true)
          throw new Error("Read-only session cannot be destroyed")
        if (id) cookieStore.delete(sessionCookieName(id))
      },
    },
    updateConfig: { value: () => {} },
    save: {
      value: async (options?: SessionSaveOptions) => {
        assertReceptionOpen()
        const currentOperation = sessionOperation.getStore()
        if (currentOperation?.readOnly === true)
          throw new Error("Read-only session cannot be saved")
        if (currentOperation && session.coordinationId !== currentOperation.id)
          throw new Error("Session generation mismatch")
        if (!session.coordinationId || (id && session.coordinationId !== id))
          throw new Error("Session admission required before saving state")
        id = session.coordinationId
        session.serverId = env.participantApiServerId
        session.stage ??= "unauthenticated"
        session.rootStep ??= "start"
        const current = readAuthority(id)
        if (
          expectedHash &&
          (current?.hash !== expectedHash ||
            current.revision !== revision ||
            (currentOperation && current.busy !== currentOperation.operationId))
        )
          throw new Error("stale_session_state")
        if (options) {
          const priorState = current?.state
            ? sessionStateSchema.parse(JSON.parse(current.state))
            : null
          if (
            !expectedHash ||
            options.startAnalysisId !== session.activeAnalysisId ||
            options.startAnalysisId === priorState?.activeAnalysisId
          )
            throw new Error("Invalid analysis admission")
        }
        let { state, privateState } = splitSessionData(session)
        const privateJson = JSON.stringify(privateState)
        const businessChanged = hashSessionState(state) !== expectedHash
        const privateChanged = privateJson !== priorPrivate
        if (expectedHash && !businessChanged && !privateChanged) {
          if (options) throw new Error("Analysis admission requires new state")
          return
        }
        if (privateChanged && !currentOperation)
          throw new Error("Browser context requires a guarded operation")
        // Internal CAS revisions include preparation; the UI stamp advances only
        // for identity/authentication/business transitions.
        if (businessChanged)
          session.stateRevision = (session.stateRevision ?? 0) + 1
        state = splitSessionData(session).state
        const hash = hashSessionState(state)
        const context =
          privateChanged && privateJson !== "{}"
            ? await sealData(
                {
                  purpose: "session-private",
                  id,
                  identity: browserContextIdentity(state),
                  data: privateState,
                },
                getSessionOptions(),
              )
            : null
        assertReceptionOpen()
        if (context && context.length > 32_768)
          throw new Error("Browser context exceeds storage limit")
        if (!expectedHash) {
          const credential = randomBytes(32).toString("base64url")
          if (
            createAuthority(id, hash, {
              state: JSON.stringify(state),
              credentialHash: credentialHash(credential),
            }) !== true
          )
            throw new Error("session_admission_pending")
          cookieStore.set(
            sessionCookieName(id),
            credential,
            getSessionOptions().cookieOptions,
          )
        } else {
          const saved = updateAuthority(id, (record) => {
            if (
              record.revision !== revision ||
              record.hash !== expectedHash ||
              (currentOperation && record.busy !== currentOperation.operationId)
            )
              return null
            // Both writes use updateAuthority's SQLite transaction. An active ID
            // must never become visible without its execution/restart evidence.
            if (options)
              setAnalysisOperation(
                record.id,
                options.startAnalysisId,
                "running",
              )
            return {
              ...record,
              hash,
              revision: revision + 1,
              state: JSON.stringify(state),
            }
          })
          if (saved !== true) throw new Error("stale_session_state")
        }
        if (privateChanged && currentOperation) {
          currentOperation.browserContext = context
          currentOperation.browserContextChanged = true
        }
        revision = readAuthority(id)?.revision ?? revision
        expectedHash = hash
        priorPrivate = privateJson
        sessionSnapshots.set(session, { revision, hash })
      },
    },
  })
  return session
}

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  adminSecrets,
  serviceCredential,
} from "../test-support/credentials.mjs"
import { writeSupportTerraformSettings } from "./auto-settings.mjs"
import { createEnvironmentSecretProvider } from "./secrets.mjs"
import { readSupportEnvironment } from "./support.mjs"
import { projectSupportEnvironment } from "./support-profile.mjs"
import {
  checkApplication,
  generateEnvironment,
  prepareApplicationRuntime,
} from "./workspace.mjs"

const TARGET = { name: "test", project: "synthetic-test-project" }
const REGION = "asia-northeast1"
const FOUNDATION = {
  version: 1,
  project: TARGET.project,
  region: REGION,
  repository: `projects/${TARGET.project}/locations/${REGION}/repositories/support-images`,
  runtimeServiceAccount: `support-runtime@${TARGET.project}.iam.gserviceaccount.com`,
  schedulerServiceAccount: `support-scheduler@${TARGET.project}.iam.gserviceaccount.com`,
  gmailSecretIds: {
    clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET",
    refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN",
  },
  serviceEndpoint: {
    name: "support-service",
    projectNumber: "123456789012",
    baseUrl: "https://support-service-123456789012.asia-northeast1.run.app",
  },
}
const SECRETS = {
  SUPPORT_WEB_API_CREDENTIAL: `test-reader.${"b".repeat(43)}`,
  SUPPORT_TOKEN_KEY: "synthetic-email-token-key-000000000000000000000000",
  CLIENT_SECRET: " literal $VALUE\\nsecret ",
  REFRESH_TOKEN: "refresh-token",
}
const accessProfile = () => ({
  notBefore: "1970-01-01T00:00:00.000Z",
  expiresAt: "9999-12-31T23:59:59.999Z",
  backendStopsAt: "9999-12-31T23:59:59.999Z",
  revoked: false,
})
const profile = () => ({
  admissionOpen: false,
  maintenanceEnabled: false,
  contactEmail: "contact@example.invalid",
  tokenKey: { secret: "SUPPORT_TOKEN_KEY" },
  access: accessProfile(),
  gmail: {
    clientId: "synthetic.apps.googleusercontent.com",
    clientSecret: { secret: "CLIENT_SECRET" },
    refreshToken: { secret: "REFRESH_TOKEN" },
    sender: "sender@example.invalid",
  },
})
const project = (
  input = profile(),
  automatic = { terraform: { support: FOUNDATION } },
  infrastructure = { region: REGION },
) =>
  projectSupportEnvironment(
    input,
    TARGET,
    automatic,
    createEnvironmentSecretProvider(SECRETS),
    infrastructure,
    "test-server",
    "^recipient@example[.]invalid$",
  )

test("support projection gets identity from Terraform, derives environment and preserves secret bytes", () => {
  const settings = project()
  const runtime = readSupportEnvironment(settings)
  assert.equal(runtime.baseUrl, FOUNDATION.serviceEndpoint.baseUrl)
  assert.equal(runtime.schedulerIdentity, FOUNDATION.schedulerServiceAccount)
  assert.deepEqual(runtime.credentials, [
    {
      notBeforeMs: 0,
      expiresAtMs: 253402300799999,
      revoked: false,
      operations: [
        "readDocumentOriginal",
        "sendMagicLink",
        "verifyAuthentication",
        "withdrawParticipation",
        "listParticipationEvents",
        "getParticipationState",
        "recordAnalysisAttempt",
        "recordAnalysisOutcome",
        "recordAnalysisCompletion",
        "submitSurvey",
        "getInformation",
      ],
      id: "test-reader",
      serverId: "test-server",
      environment: "test",
      verifierHash: createHash("sha256").update("b".repeat(43)).digest("hex"),
    },
  ])
  assert.ok(
    !settings.SUPPORT_RUNTIME_JSON.includes(SECRETS.SUPPORT_WEB_API_CREDENTIAL),
  )
  assert.ok(!settings.SUPPORT_RUNTIME_JSON.includes("b".repeat(43)))
  assert.equal(runtime.gmail.clientSecret, SECRETS.CLIENT_SECRET)
  assert.deepEqual(Object.keys(settings).sort(), [
    "AERPP_ENVIRONMENT",
    "GCP_PROJECT_ID",
    "SUPPORT_RUNTIME_JSON",
  ])
})

test("support rejects manual identity overrides, plaintext secrets, missing outputs and stale region", () => {
  for (const patch of [
    { baseUrl: "https://override.example.invalid" },
    { projectId: "another-project" },
    { schedulerIdentity: "another@example.invalid" },
    { tokenKey: "plaintext-secret" },
    {
      local: {
        baseUrl: "http://127.0.0.1:8080",
        firestoreEmulatorHost: "127.0.0.1:8088",
      },
    },
    { credentials: [{ environment: "test" }] },
    { webAccess: { ...accessProfile(), operations: ["addInformation"] } },
    { credentials: [] },
    { webAccess: { ...accessProfile(), expiresAtMs: 0 } },
    { access: undefined },
    { access: { ...accessProfile(), revoked: "false" } },
    { access: { ...accessProfile(), operations: ["addInformation"] } },
  ])
    assert.throws(() => project({ ...profile(), ...patch }))
  assert.throws(() => project(profile(), {}))
  assert.throws(() =>
    project(profile(), {
      terraform: { support: { ...FOUNDATION, serviceEndpoint: undefined } },
    }),
  )
  assert.throws(() => project(profile(), undefined, { region: "us-central1" }))
  assert.throws(() =>
    project(profile(), {
      terraform: {
        support: {
          ...FOUNDATION,
          serviceEndpoint: {
            ...FOUNDATION.serviceEndpoint,
            baseUrl: "https://wrong.example.invalid",
          },
        },
      },
    }),
  )
})

test("selected Support resolves only its own credentials and generates private runtime settings", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-support-profile-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    const config = JSON.stringify({
      version: 1,
      web: {
        nextPublicParticipantEmailPattern: "^recipient@example[.]invalid$",
      },
      shared: { participantApiServerId: "test-server" },
      infrastructure: { region: REGION },
      support: {
        ...profile(),
        gmail: {
          sender: profile().gmail.sender,
          refreshToken: profile().gmail.refreshToken,
        },
      },
    })
    const secret = JSON.stringify({
      ...SECRETS,
      SUPPORT_GMAIL_OAUTH_CLIENT_JSON: {
        web: {
          project_id: TARGET.project,
          client_id: profile().gmail.clientId,
          client_secret: SECRETS.CLIENT_SECRET,
        },
      },
    })
    writeFileSync(join(directory, "config.json"), config)
    writeFileSync(join(directory, "secret.json"), secret)
    writeSupportTerraformSettings(directory, TARGET, FOUNDATION)
    const projects = { test: TARGET.project }
    const { values } = prepareApplicationRuntime("test", directory, {
      projects: projects,
      apps: "support",
    })
    assert.deepEqual(Object.keys(values), ["support"])
    assert.equal(
      readSupportEnvironment(values.support).projectId,
      TARGET.project,
    )
    assert.equal(
      readSupportEnvironment(values.support).gmail.participantEmailPattern,
      "^recipient@example[.]invalid$",
    )
    generateEnvironment(
      "test",
      directory,
      projects,
      join(directory, "output"),
      "support",
    )
    assert.equal(
      statSync(join(directory, "output/support.json")).mode & 0o777,
      0o600,
    )
    assert.equal(readFileSync(join(directory, "config.json"), "utf8"), config)
    assert.equal(readFileSync(join(directory, "secret.json"), "utf8"), secret)
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({
        version: 1,
        web: {
          nextPublicParticipantEmailPattern: "^recipient@example[.]invalid$",
        },
        shared: { participantApiServerId: "synthetic-server" },
        support: {
          access: {
            ...accessProfile(),
            expiresAt: "2099-01-01T00:00:00Z",
            backendStopsAt: "2099-12-31T00:00:00Z",
          },
          contactEmail: "support@example.invalid",
          gmail: { sender: "sender@example.invalid" },
        },
        admin: {},
      }),
    )
    writeFileSync(
      join(directory, "secret.json"),
      JSON.stringify({ ...SECRETS, ...adminSecrets(TARGET.project) }),
    )
    assert.doesNotThrow(() =>
      prepareApplicationRuntime("test", directory, {
        projects: projects,
        apps: "admin",
      }),
    )
    assert.throws(
      () =>
        prepareApplicationRuntime("production", directory, {
          projects: { production: "synthetic-production" },
          apps: "support",
        }),
      /mismatch/,
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("local support is explicit and never resolves Gmail secrets", () => {
  const input = profile()
  delete input.gmail
  input.local = {
    baseUrl: "http://127.0.0.1:8080",
    firestoreEmulatorHost: "127.0.0.1:8088",
  }
  const settings = projectSupportEnvironment(
    input,
    { name: "example", project: "demo-support" },
    {},
    createEnvironmentSecretProvider({
      SUPPORT_TOKEN_KEY: SECRETS.SUPPORT_TOKEN_KEY,
      SUPPORT_WEB_API_CREDENTIAL: SECRETS.SUPPORT_WEB_API_CREDENTIAL,
    }),
    undefined,
    "test-server",
  )
  assert.equal(readSupportEnvironment(settings).mailMode, "sink")
  for (const local of [
    { ...input.local, baseUrl: "https://remote.example.invalid" },
    { ...input.local, firestoreEmulatorHost: "remote.example.invalid:8088" },
  ])
    assert.throws(() =>
      projectSupportEnvironment(
        { ...input, local },
        { name: "example", project: "demo-support" },
        {},
        createEnvironmentSecretProvider(SECRETS),
        undefined,
        "test-server",
      ),
    )
})

test("Web resolves its Support routes without Gmail secrets", async () => {
  const { readWebEnvironment } = await import("./web.mjs")
  const { applicationEnvironment } = await import("./process.mjs")
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-support-web-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    const config = {
      version: 1,
      infrastructure: { region: REGION },
      shared: { participantApiServerId: "test-server" },
      web: {
        nextPublicParticipantEmailPattern: "^recipient@example[.]invalid$",
        supportApiCredential: { secret: "SUPPORT_WEB_API_CREDENTIAL" },
        identifierHashSecret: { secret: "IDENTIFIER_HASH_SECRET" },
        sessionSealPassword: { secret: "SESSION_SEAL_PASSWORD" },
      },
      support: {
        access: {
          ...accessProfile(),
          expiresAt: "2099-01-01T00:00:00Z",
          backendStopsAt: "2099-12-31T00:00:00Z",
        },
        contactEmail: "support@example.invalid",
        gmail: { sender: "sender@example.invalid" },
      },
    }
    writeFileSync(join(directory, "config.json"), JSON.stringify(config))
    writeFileSync(
      join(directory, "secret.json"),
      JSON.stringify({
        SUPPORT_WEB_API_CREDENTIAL: `test-reader.${"b".repeat(43)}`,
        IDENTIFIER_HASH_SECRET: "synthetic-identifier",
        SESSION_SEAL_PASSWORD: "s".repeat(32),
      }),
    )
    writeSupportTerraformSettings(directory, TARGET, FOUNDATION)
    const read = () =>
      prepareApplicationRuntime("test", directory, {
        projects: { test: TARGET.project },
        apps: "web",
      }).values.web
    const settings = read()
    assert.doesNotThrow(() => checkApplication("web", settings, "test"))
    assert.throws(
      () =>
        checkApplication(
          "web",
          { ...settings, SUPPORT_API_CREDENTIAL: "" },
          "test",
        ),
      /SUPPORT_API_CREDENTIAL/,
    )
    assert.equal(settings.SUPPORT_RUNTIME_JSON, undefined)
    assert.equal(
      readWebEnvironment(settings).authenticationEmailSender,
      "sender@example.invalid",
    )
    assert.equal(
      readWebEnvironment(settings).getInformationUrl,
      `${FOUNDATION.serviceEndpoint.baseUrl}/api/participant/information`,
    )
    const isolated = applicationEnvironment({}, { ...settings })
    assert.equal(isolated.SUPPORT_API_CREDENTIAL, "")
    assert.equal(isolated.SUPPORT_API_BASE_URL, "")
    assert.equal(isolated.AUTHENTICATION_EMAIL_SENDER, "")
    assert.equal(isolated.SUPPORT_CONTACT_EMAIL, "")
    assert.equal(settings.SUPPORT_CONTACT_EMAIL, config.support.contactEmail)
    assert.equal(isolated.SUPPORT_RECEPTION_EXPIRES_AT, "")
    assert.equal(
      settings.SUPPORT_RECEPTION_EXPIRES_AT,
      config.support.access.expiresAt,
    )
    const access = config.support.access
    for (const invalidAccess of [undefined, { ...access, revoked: "false" }]) {
      config.support.access = invalidAccess
      writeFileSync(join(directory, "config.json"), JSON.stringify(config))
      assert.throws(read, /support.access/)
    }
    config.support.access = access
    config.support.gmail.sender = "invalid"
    writeFileSync(join(directory, "config.json"), JSON.stringify(config))
    assert.throws(read, /support.gmail.sender/)
    delete config.support.gmail
    writeFileSync(join(directory, "config.json"), JSON.stringify(config))
    assert.equal(
      readWebEnvironment(read()).authenticationEmailSender,
      undefined,
    )
    for (const region of [undefined, "us-central1"]) {
      config.infrastructure.region = region
      writeFileSync(join(directory, "config.json"), JSON.stringify(config))
      assert.throws(read)
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("whole profiles project exactly the maintained applications", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-support-whole-profile-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({
        version: 1,
        infrastructure: { region: REGION },
        shared: { participantApiServerId: "test-server" },
        web: {
          nextPublicParticipantEmailPattern: "^recipient@example[.]invalid$",
          supportApiCredential: { secret: "SUPPORT_WEB_API_CREDENTIAL" },
          identifierHashSecret: { secret: "IDENTIFIER_HASH_SECRET" },
          sessionSealPassword: { secret: "SESSION_SEAL_PASSWORD" },
        },
        admin: {},
        logging: {},
        support: {
          ...profile(),
          gmail: {
            sender: profile().gmail.sender,
            refreshToken: profile().gmail.refreshToken,
          },
        },
      }),
    )
    writeFileSync(
      join(directory, "secret.json"),
      JSON.stringify({
        ...SECRETS,
        SUPPORT_GMAIL_OAUTH_CLIENT_JSON: {
          web: {
            project_id: TARGET.project,
            client_id: profile().gmail.clientId,
            client_secret: SECRETS.CLIENT_SECRET,
          },
        },
        ...adminSecrets(TARGET.project),
        LOGGING_SERVICE_ACCOUNT_JSON: serviceCredential(
          TARGET.project,
          "logging",
        ),
        SUPPORT_WEB_API_CREDENTIAL: `test-reader.${"b".repeat(43)}`,
        IDENTIFIER_HASH_SECRET: "synthetic-identifier",
        SESSION_SEAL_PASSWORD: "s".repeat(32),
      }),
    )
    writeSupportTerraformSettings(directory, TARGET, FOUNDATION)
    const { values } = prepareApplicationRuntime("test", directory, {
      projects: {
        test: TARGET.project,
      },
    })
    assert.deepEqual(Object.keys(values).sort(), [
      "admin",
      "logging",
      "support",
      "web",
    ])
    assert.equal(
      readSupportEnvironment(values.support).projectId,
      TARGET.project,
    )
    assert.equal(
      readSupportEnvironment(values.support).gmail.participantEmailPattern,
      "^recipient@example[.]invalid$",
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("derived callers reject invalid secrets and server IDs without exposing credentials", () => {
  for (const caller of [
    "",
    "YOUR_SECRET",
    "reader.short",
    `reader.${"b".repeat(43)}\n`,
  ]) {
    assert.throws(
      () =>
        projectSupportEnvironment(
          profile(),
          TARGET,
          { terraform: { support: FOUNDATION } },
          createEnvironmentSecretProvider({
            ...SECRETS,
            SUPPORT_WEB_API_CREDENTIAL: caller,
          }),
          { region: REGION },
          "test-server",
          "^recipient@example[.]invalid$",
        ),
      (error) =>
        !error.message.includes("reader.short") &&
        !error.message.includes("b".repeat(43)),
    )
  }
  for (const serverId of [undefined, "", "YOUR_SERVER_ID"])
    assert.throws(() =>
      projectSupportEnvironment(
        profile(),
        TARGET,
        { terraform: { support: FOUNDATION } },
        createEnvironmentSecretProvider(SECRETS),
        { region: REGION },
        serverId,
      ),
    )
})

test("derived callers retain shared access revocation and validity policy", () => {
  const access = {
    ...accessProfile(),
    revoked: true,
    notBefore: "1970-01-01T09:00:00.100+09:00",
    expiresAt: "1970-01-01T00:00:00.200Z",
  }
  const caller = readSupportEnvironment(project({ ...profile(), access }))
    .credentials[0]
  assert.equal(caller.revoked, true)
  assert.equal(caller.notBeforeMs, 100)
  assert.equal(caller.expiresAtMs, Date.parse(access.backendStopsAt))
  access.expiresAt = access.notBefore
  assert.throws(() => project({ ...profile(), access }))
})

test("Web operation projection excludes operator access and participant-history erasure", () => {
  for (const name of ["test", "production"]) {
    const env = projectSupportEnvironment(
      profile(),
      { ...TARGET, name },
      { terraform: { support: FOUNDATION } },
      createEnvironmentSecretProvider(SECRETS),
      { region: REGION },
      "test-server",
      "^recipient@example[.]invalid$",
    )
    const operations = readSupportEnvironment(env).credentials[0].operations
    assert.ok(operations.includes("submitSurvey"))
    assert.ok(!operations.includes("addInformation"))
    assert.ok(!operations.includes("magicCompletePage"))
    assert.equal(operations.includes("debugResetParticipation"), false)
  }
})

test("cloud recipient policy requires the Web pattern", () => {
  for (const pattern of [undefined, "", " ", "["])
    assert.throws(() =>
      projectSupportEnvironment(
        profile(),
        TARGET,
        { terraform: { support: FOUNDATION } },
        createEnvironmentSecretProvider(SECRETS),
        { region: REGION },
        "test-server",
        pattern,
      ),
    )
  assert.equal(
    readSupportEnvironment(project()).gmail.participantEmailPattern,
    "^recipient@example[.]invalid$",
  )
})

test("test participant addresses are projected only to the selected Support runtime", () => {
  const env = projectSupportEnvironment(
    profile(),
    TARGET,
    { terraform: { support: FOUNDATION } },
    createEnvironmentSecretProvider(SECRETS),
    { region: REGION },
    "test-server",
    "^recipient@example[.]invalid$",
    ["Researcher@Example.invalid"],
  )
  assert.deepEqual(readSupportEnvironment(env).testEmailAddresses, [
    "researcher@example.invalid",
  ])
  assert.throws(
    () =>
      projectSupportEnvironment(
        profile(),
        TARGET,
        { terraform: { support: FOUNDATION } },
        createEnvironmentSecretProvider(SECRETS),
        { region: REGION },
        "test-server",
        "^recipient@example[.]invalid$",
        ["invalid-private-value"],
      ),
    (error) => !error.message.includes("invalid-private-value"),
  )
})

test("Support continues after Web reception until its independent backend stop", () => {
  const access = {
    ...accessProfile(),
    expiresAt: "2026-10-31T23:59:59+09:00",
    backendStopsAt: "2026-11-30T23:59:59+09:00",
  }
  const runtime = readSupportEnvironment(project({ ...profile(), access }))
  assert.equal(
    runtime.credentials[0].expiresAtMs,
    Date.parse(access.backendStopsAt),
  )
  assert.ok(runtime.credentials[0].expiresAtMs > Date.parse(access.expiresAt))
})

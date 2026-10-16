import { resolveLlmPresetPath } from "@aerpp/config/llm"
import { readRequiredEnvironment, resolveGcpProjectId } from "../src/index.mjs"
import {
  createEnvironmentSecretProvider,
  resolveSecretReferences,
} from "../src/secrets.mjs"

const provider = createEnvironmentSecretProvider({
  SUPPORT_API_CREDENTIAL: "synthetic",
})
const values = resolveSecretReferences(
  { key: { secret: "SUPPORT_API_CREDENTIAL" } },
  provider,
)
const key: string = readRequiredEnvironment(values, "key")
const project: string | undefined = resolveGcpProjectId({
  GCP_PROJECT_ID: "demo-test",
})
void key
void project

const llmPath: string = resolveLlmPresetPath()
void llmPath

import { applicationEnvironment } from "@aerpp/config/process"
import { deriveApplicationEnvironments } from "@aerpp/config/profiles"
import { assertEnvironmentSafety } from "@aerpp/config/safety"
import { environmentTarget } from "@aerpp/config/targets"
import { readWebEnvironment } from "@aerpp/config/web"
import { prepareApplicationRuntime } from "@aerpp/config/workspace"

assertEnvironmentSafety(applicationEnvironment({}))
const debug: boolean = readWebEnvironment({}).debugPagesEnabled
const selectedProject: string = environmentTarget("example").project
void debug
void selectedProject
void prepareApplicationRuntime

const selected = deriveApplicationEnvironments(
  {
    version: 1,
    secretProvider: { type: "environment" },
    shared: {},
    admin: {},
  },
  { name: "test", project: "synthetic-cloud-project" },
  ["admin"],
)
void selected.admin
// @ts-expect-error Unselected consumers are not projected.
void selected.web

import {
  adminServiceUrl,
  readAdminDeployment,
} from "@aerpp/config/admin-deployment"

const adminUrl: string = adminServiceUrl(
  readAdminDeployment("test"),
  "123456789000",
)
void adminUrl

import { readAdminEnvironment } from "@aerpp/config/admin"
import type { env as adminEnv } from "@aerpp/config/server/admin"
import type { env as webEnv } from "@aerpp/config/server/web"
import { validateWebEnvironment } from "@aerpp/config/web-validation"

const adminBypass: boolean = readAdminEnvironment({}).adminAuthBypassEnabled
const webErrors: string[] = validateWebEnvironment({})
const webRuntime: typeof webEnv = readWebEnvironment({})
const adminRuntime: typeof adminEnv = readAdminEnvironment({})
void adminBypass
void webErrors
void webRuntime
void adminRuntime

import { buildSupportUrls, SUPPORT_ROUTES } from "@aerpp/config/support-routes"

const supportUrl: string = buildSupportUrls(
  "https://support.example.invalid",
).sendMagicLink
const confirmationPath: "/email/confirm" = SUPPORT_ROUTES.magicCompletePage
void supportUrl
void confirmationPath

import {
  deriveSupportTerraformInputs,
  parseSupportTerraformOutputs,
  type SupportFoundation,
} from "@aerpp/config/terraform"

const terraformRegion: string = deriveSupportTerraformInputs(
  { version: 1, infrastructure: { region: "asia-northeast1" } },
  { name: "test", project: "synthetic-test-project" },
).region
const terraformOutput: SupportFoundation = parseSupportTerraformOutputs(
  {},
  { name: "test", project: "synthetic-test-project" },
  terraformRegion,
)
void terraformOutput

import {
  projectSupportEnvironment,
  type SupportProfile,
} from "@aerpp/config/support-profile"

const supportProfile: SupportProfile = {
  access: {
    notBefore: "1970-01-01T00:00:00.000Z",
    expiresAt: "9999-12-31T23:59:59.999Z",
    backendStopsAt: "9999-12-31T23:59:59.999Z",
    revoked: false,
  },
  admissionOpen: false,
  maintenanceEnabled: false,
  contactEmail: "contact@example.invalid",
  tokenKey: { secret: "SUPPORT_TOKEN_KEY" },
  local: {
    baseUrl: "http://127.0.0.1:8080",
    firestoreEmulatorHost: "127.0.0.1:8088",
  },
}
const projectedSupport: Record<string, string | undefined> =
  projectSupportEnvironment(
    supportProfile,
    { name: "example", project: "demo-support" },
    {},
    { getSecret: () => "synthetic" },
    undefined,
    "synthetic-server",
  )
void projectedSupport

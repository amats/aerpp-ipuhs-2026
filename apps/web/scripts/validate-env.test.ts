import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { spawnCaptured } from "../test-support/spawn-captured.mjs"

const repoRoot = path.resolve(__dirname, "..")
const scriptPath = path.join(repoRoot, "scripts", "validate-env.mjs")

const VALID_ENV = `
PARTICIPANT_API_SERVER_ID=test-server
IDENTIFIER_HASH_SECRET=test-server-key
SESSION_SEAL_PASSWORD=test-password-0123456789abcdef0123456789abcdef
AERPP_ENVIRONMENT=test
SUPPORT_API_BASE_URL=https://support.example.invalid
SUPPORT_API_CREDENTIAL=synthetic.${"a".repeat(43)}
SUPPORT_RECEPTION_EXPIRES_AT=2099-01-01T00:00:00Z
SUPPORT_CONTACT_EMAIL=support@example.invalid
`

const defaultConfig = JSON.parse(
  readFileSync(
    path.join(repoRoot, "../../config/common/llm/lms-medgemma.json"),
    "utf8",
  ),
)

function runValidateEnv(
  extraEnv = "",
  config: unknown = defaultConfig,
  options: {
    inheritedEnv?: Partial<NodeJS.ProcessEnv>
    fileContents?: string | null
    active?: boolean
  } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "aerpp-env-"))
  const envPath = path.join(directory, ".env.local")
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    ...options.inheritedEnv,
    NODE_ENV: options.inheritedEnv?.NODE_ENV ?? "test",
  }
  const appDirectory = path.join(directory, "apps/web")
  mkdirSync(appDirectory, { recursive: true })
  const configsDirectory = path.join(directory, "config/common/llm")
  mkdirSync(configsDirectory, { recursive: true })
  writeFileSync(
    path.join(configsDirectory, "lms-medgemma.json"),
    JSON.stringify(config),
  )
  if (options.fileContents !== null) {
    writeFileSync(envPath, options.fileContents ?? `${VALID_ENV}${extraEnv}`)
  }
  try {
    return spawnCaptured(
      process.execPath,
      options.active ? [scriptPath] : [scriptPath, envPath],
      {
        cwd: appDirectory,
        env,
      },
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

describe("validate-env", () => {
  it.each([
    "PARTICIPANT_API_SERVER_ID",
    "IDENTIFIER_HASH_SECRET",
    "SESSION_SEAL_PASSWORD",
    "SUPPORT_API_CREDENTIAL",
  ])("rejects whitespace-only required %s values", (key) => {
    const result = runValidateEnv(`${key}="   "\n`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`- ${key}`)
  })

  it("rejects short session keys without printing the key", () => {
    const result = runValidateEnv("SESSION_SEAL_PASSWORD=short-private-key\n")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "SESSION_SEAL_PASSWORD (expected: at least 32 characters)",
    )
    expect(result.stderr).not.toContain("short-private-key")
  })

  it("treats whitespace-only optional values as unset, matching runtime", () => {
    const result = runValidateEnv(
      'DEBUG_PAGES_ENABLED="   "\nSESSION_COOKIE_SECURE="   "\nLOG_LEVEL="   "\nLLM_PRESET_FILE="   "\n',
    )
    expect(result.status).toBe(0)
  })

  it("does not let inherited credentials fill gaps in explicit files", () => {
    const result = runValidateEnv("", defaultConfig, {
      fileContents: VALID_ENV.replace(
        "IDENTIFIER_HASH_SECRET=test-server-key",
        "",
      ),
      inheritedEnv: { IDENTIFIER_HASH_SECRET: "parent-only-secret" },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("- IDENTIFIER_HASH_SECRET")
    expect(result.stderr).not.toContain("parent-only-secret")
  })

  it("ignores inherited configuration when validating an explicit file", () => {
    const result = runValidateEnv("LOG_LEVEL=info\n", defaultConfig, {
      inheritedEnv: {
        LOG_LEVEL: "invalid",
        LLM_PRESET_FILE: "missing.json",
        SUPPORT_RECEPTION_EXPIRES_AT: "2000-01-01",
      },
    })

    expect(result.status).toBe(0)
  })

  it("does not let inherited valid values mask invalid file values", () => {
    const result = runValidateEnv("LOG_LEVEL=invalid\n", defaultConfig, {
      inheritedEnv: { LOG_LEVEL: "info" },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LOG_LEVEL (expected:")
  })

  it("rejects a missing explicitly requested environment file", () => {
    const result = runValidateEnv("", defaultConfig, { fileContents: null })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Cannot read environment file:")
  })

  it("does not load package-local dotenv files implicitly", () => {
    const result = runValidateEnv("", defaultConfig, { active: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("PARTICIPANT_API_SERVER_ID")
  })

  it("preserves process environment precedence in active-environment mode", () => {
    const result = runValidateEnv("LOG_LEVEL=info\n", defaultConfig, {
      active: true,
      inheritedEnv: { LOG_LEVEL: "invalid" },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LOG_LEVEL (expected:")
  })

  it("accepts a complete process environment without .env.local", () => {
    const result = runValidateEnv("", defaultConfig, {
      active: true,
      fileContents: null,
      inheritedEnv: {
        PARTICIPANT_API_SERVER_ID: "test-server",
        IDENTIFIER_HASH_SECRET: "test-server-key",
        SESSION_SEAL_PASSWORD:
          "test-session-key-0123456789abcdef0123456789abcdef",
        AERPP_ENVIRONMENT: "test",
        SUPPORT_API_BASE_URL: "https://support.example.invalid",
        SUPPORT_API_CREDENTIAL: `synthetic.${"a".repeat(43)}`,
        SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
        SUPPORT_CONTACT_EMAIL: "support@example.invalid",
      },
    })

    expect(result.status).toBe(0)
  })

  it("accepts explicit debug page booleans", () => {
    expect(runValidateEnv("DEBUG_PAGES_ENABLED=true\n").status).toBe(0)
    expect(runValidateEnv("DEBUG_PAGES_ENABLED=false\n").status).toBe(0)
    expect(runValidateEnv("DEBUG_PAGES_ENABLED=TRUE\n").status).toBe(0)
  })

  it("validates the secure-cookie override", () => {
    expect(runValidateEnv("SESSION_COOKIE_SECURE=true\n").status).toBe(0)
    expect(runValidateEnv("SESSION_COOKIE_SECURE=FALSE\n").status).toBe(0)

    const result = runValidateEnv("SESSION_COOKIE_SECURE=maybe\n")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "SESSION_COOKIE_SECURE (expected: true or false)",
    )
  })

  it("validates log levels", () => {
    expect(runValidateEnv("LOG_LEVEL=trace\n").status).toBe(0)

    const result = runValidateEnv("LOG_LEVEL=verbose\n")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LOG_LEVEL (expected:")
  })

  it("validates the client email pattern", () => {
    expect(
      runValidateEnv(
        "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN=/^[^@]+@[^@]+$/gi\n",
      ).status,
    ).toBe(0)

    const result = runValidateEnv(
      "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN=[invalid\n",
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN (expected: valid regular expression)",
    )
  })

  it("rejects invalid debug page values", () => {
    const result = runValidateEnv("DEBUG_PAGES_ENABLED=maybe\n")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "DEBUG_PAGES_ENABLED (expected: true or false)",
    )
  })

  it("accepts the default LLM config", () => {
    expect(runValidateEnv().status).toBe(0)
  })

  it("requires the selected LLM config file to exist", () => {
    const result = runValidateEnv("LLM_PRESET_FILE=missing-config.json\n")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "LLM_PRESET_FILE (file not found: missing-config.json)",
    )
  })

  it.each([
    "https://external.example/v1",
    "http://host.docker.internal.external.example:1234/v1",
    "http://user:password@host.docker.internal:1234/v1",
    "http://host.docker.internal:1234/v1?redirect=external",
    "ws://host.docker.internal:1234/v1",
    "http://host.docker.internal:1234/other",
  ])("rejects non-local or unsupported LLM endpoints: %s", (baseUrl) => {
    const result = runValidateEnv("", { ...defaultConfig, baseUrl })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LLM config baseUrl")
  })

  it.each([
    null,
    [],
    { ...defaultConfig, unexpected: true },
    { ...defaultConfig, generation: { temperature: 0 } },
    { ...defaultConfig, generation: null },
    { ...defaultConfig, license: null },
  ])("rejects invalid configs and unknown fields: %j", (config) => {
    const result = runValidateEnv("", config)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LLM config")
    expect(result.stderr).not.toContain("TypeError")
  })

  it.each([
    "http://host.docker.internal:1234/v1",
    "http://localhost:1234/v1/",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:1234/v1",
  ])("accepts local LLM endpoints: %s", (baseUrl) => {
    expect(runValidateEnv("", { ...defaultConfig, baseUrl }).status).toBe(0)
  })
})

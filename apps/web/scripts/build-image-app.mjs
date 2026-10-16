import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { resolveSurveyPath, SURVEY_FILES } from "@aerpp/config/survey"
import { REQUIRED_ASSETS } from "./image-inputs.mjs"

for (const name of REQUIRED_ASSETS) {
  if (!readFileSync(`assets/${name}`).length)
    throw new Error(`Empty asset: ${name}`)
}
for (const name of SURVEY_FILES) {
  const file = resolveSurveyPath(name)
  writeFileSync(
    file,
    createQuestionnaireArtifact(readFileSync(file, "utf8")).json,
  )
}
const inputs = JSON.parse(readFileSync("/run/secrets/web_build", "utf8"))
if (
  Object.keys(inputs).some(
    (key) => key !== "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN",
  )
)
  throw new Error("Unexpected build setting")
const result = spawnSync("pnpm", ["run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...inputs,
    NODE_ENV: "production",
    PARTICIPANT_API_SERVER_ID: "image-build",
    AERPP_ENVIRONMENT: "test",
    SUPPORT_API_BASE_URL: "https://support.example.invalid",
    SUPPORT_API_CREDENTIAL: `synthetic.${"a".repeat(43)}`,
    SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    SUPPORT_CONTACT_EMAIL: "support@example.invalid",
    IDENTIFIER_HASH_SECRET: "synthetic-image-build-identifier-key",
    SESSION_SEAL_PASSWORD:
      "synthetic-image-build-session-password-32-characters",
    SESSION_COOKIE_SECURE: "true",
    DEBUG_PAGES_ENABLED: "false",
    LOG_LEVEL: "silent",
  },
})
process.exitCode = result.status ?? 1

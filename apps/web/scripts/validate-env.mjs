import { validateWebEnvironment } from "@aerpp/config/web-validation"
import dotenv from "dotenv"

const args = process.argv.slice(2)
const processOnly = args.includes("--process-only")
if (processOnly && args.length !== 1) {
  console.error("--process-only cannot be combined with environment files")
  process.exit(1)
}
const envPaths = processOnly ? [] : args

// Explicit files must pass on their own; ambient variables cannot fill gaps.
const env = envPaths.length === 0 ? { ...process.env } : {}
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, processEnv: env, quiet: true })
  if (result.error) {
    console.error(`Cannot read environment file: ${envPath}`)
    process.exit(1)
  }
}

// Runtime readers treat whitespace-only values as absent without trimming secrets.
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string" && value.trim() === "") delete env[key]
}

const validationErrors = validateWebEnvironment(env)

if (validationErrors.length > 0) {
  console.error("Invalid environment configuration:")
  for (const key of validationErrors) {
    console.error(`- ${key}`)
  }
  process.exit(1)
}

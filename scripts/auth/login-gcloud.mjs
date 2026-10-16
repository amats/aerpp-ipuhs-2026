import { login } from "./auth-login.mjs"

try {
  login("gcloud", process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

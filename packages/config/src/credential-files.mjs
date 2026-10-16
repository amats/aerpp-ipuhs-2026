import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { basename, resolve } from "node:path"

export const SERVICE_CREDENTIAL_KEYS = Object.freeze({
  logging: "LOGGING_SERVICE_ACCOUNT_JSON",
})
export function parseServiceCredential(value, project, app) {
  try {
    if (!Object.hasOwn(SERVICE_CREDENTIAL_KEYS, app)) throw new Error()
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error()
    const credential = value
    if (
      credential.type !== "service_account" ||
      credential.project_id !== project ||
      typeof credential.private_key !== "string" ||
      !credential.private_key.trim() ||
      typeof credential.client_email !== "string" ||
      !credential.client_email.endsWith(`@${project}.iam.gserviceaccount.com`)
    )
      throw new Error()
    return credential
  } catch {
    throw new Error(
      `${app}: service-account credential must belong to the selected project`,
    )
  }
}
export function storedServiceIdentity(directory, target, app) {
  const file = resolve(directory, "secret.json")
  if (!existsSync(file)) return undefined
  let value
  try {
    value = JSON.parse(readFileSync(file, "utf8"))[SERVICE_CREDENTIAL_KEYS[app]]
  } catch {
    throw new Error("Cannot read the selected secret store")
  }
  if (
    value === undefined ||
    (typeof value === "string" && /^(YOUR_|replace[-_ ]with)/i.test(value))
  )
    return undefined
  return parseServiceCredential(value, target.project, app).client_email
}
export function materializeServiceCredential(directory, target, app, value) {
  const credential = parseServiceCredential(value, target.project, app)
  const output = resolve(
    directory,
    "../../generated",
    basename(directory),
    "credentials",
  )
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const file = resolve(output, `${app}.json`)
  const contents = `${JSON.stringify(
    {
      ...credential,
      _comment: "Generated from the private secret store; do not edit",
    },
    null,
    2,
  )}\n`
  if (!existsSync(file) || readFileSync(file, "utf8") !== contents) {
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" })
    renameSync(temporary, file)
  }
  chmodSync(file, 0o600)
  return file
}

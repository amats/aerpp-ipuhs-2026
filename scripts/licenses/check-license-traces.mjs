import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { APPLICATION_LICENSE_FILES } from "./stage-license-notices.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

export function assertLicenseTrace(files, application) {
  if (Object.hasOwn(APPLICATION_LICENSE_FILES, application) !== true)
    throw new Error("Unknown license display application")
  const prefix = `apps/${application}/generated/licenses/`
  const required = [
    "LICENSE",
    "NOTICE",
    "dependencies.json",
    ...APPLICATION_LICENSE_FILES[application],
  ].map((file) => `${prefix}${file}`)
  const licenseFiles = new Set(required)
  const unsafe = files.filter(
    (file) =>
      /(?:^|\/)(?:private|secrets|\.git|test-support|tests|e2e)\//.test(file) ||
      file.startsWith("generated/") ||
      (/^(?:apps|packages)\/[^/]+\/generated\//.test(file) &&
        licenseFiles.has(file) !== true) ||
      (file.startsWith("config/") &&
        !file.startsWith("config/example/") &&
        !file.startsWith("config/common/")) ||
      /(?:^|\/)(?:\.env[^/]*|\.secret[^/]*|gcp-[^/]*\.json|client_secret[^/]*\.json|[^/]*service-account[^/]*\.json|[^/]*adminsdk[^/]*\.json|[^/]*\.(?:pem|key|p12|pfx))(?:\/|$)|\.test\.[^/]+$/.test(
        file,
      ),
  )
  if (unsafe.length)
    throw new Error(
      `${application} license trace contains ${unsafe.length} private or test files`,
    )
  for (const file of required) {
    if (files.includes(file) !== true)
      throw new Error(`${application} license trace is missing ${file}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    for (const app of ["web", "admin"]) {
      const trace = join(
        ROOT,
        "apps",
        app,
        ".next/server/app/license/page.js.nft.json",
      )
      const { files } = JSON.parse(readFileSync(trace, "utf8"))
      assertLicenseTrace(
        files.map((file) => relative(ROOT, resolve(dirname(trace), file))),
        app,
      )
      console.log(
        `${app}: license texts included; private inputs and tests excluded`,
      )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

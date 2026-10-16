import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

export function privateConfigFindings(file, contents, projectIds) {
  const findings = []
  if (projectIds.some((id) => file.includes(id) || contents.includes(id)))
    findings.push("private project identifier")
  if (
    (file.startsWith("config/") &&
      !file.startsWith("config/example/") &&
      !file.startsWith("config/common/")) ||
    file.startsWith("apps/web/assets/") ||
    /^(apps|packages)\/[^/]+\/(?:.*\/)?\.env[^/]*$/.test(file) ||
    /(^|\/)(private\/|secrets\/|\.env(?!\.example$|\.local\.example$)[^/]*$|gcp-[^/]*\.json$|client_secret[^/]*\.json$|\.secret[^/]*$|[^/]*service-account[^/]*\.json$|[^/]*adminsdk[^/]*\.json$|[^/]*\.(?:pem|key|p12|pfx)$)/.test(
      file,
    )
  )
    findings.push("private configuration path")
  if (
    /(^|\/)(generated|distribution|node_modules|\.next|dist|build|out|coverage|test-results|playwright-report|\.playwright|\.terraform)\//.test(
      file,
    ) ||
    /(?:\.tsbuildinfo|\.tfstate(?:\.[^/]*)?|\.tfplan|\.tfvars(?:\.json)?)$/.test(
      file,
    )
  )
    findings.push("generated or local artifact path")
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*(?:\\n)?[A-Za-z0-9+/]{32}/.test(
      contents,
    ) ||
    /"type"\s*:\s*"service_account"/.test(contents)
  )
    findings.push("credential material")
  if (/AIza[A-Za-z0-9_-]{35}/.test(contents))
    findings.push("embedded Google API key")
  return findings
}

export function checkPrivateConfig(root = ROOT) {
  const projectIds = []
  for (const environment of ["test", "production"]) {
    const file = resolve(root, "config", environment, "config.json")
    if (!existsSync(file)) continue
    let id
    try {
      id = JSON.parse(readFileSync(file, "utf8")).projectId
    } catch {
      throw new Error(
        "Cannot parse private project selection for publication check",
      )
    }
    if (
      typeof id === "string" &&
      !id.startsWith("demo-") &&
      !id.startsWith("YOUR_")
    )
      projectIds.push(id)
  }
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
  if (listed.status !== 0)
    throw new Error("Publication check requires Git metadata")
  const failures = []
  for (const file of new Set(listed.stdout.split("\0").filter(Boolean))) {
    const fullPath = resolve(root, file)
    if (!existsSync(fullPath)) continue
    const contents = readFileSync(fullPath).toString("utf8")
    const findings = privateConfigFindings(file, contents, projectIds)
    if (findings.length) {
      let safeFile = file
      for (const id of projectIds)
        safeFile = safeFile.replaceAll(id, "[private-project]")
      failures.push(`${safeFile}: ${findings.join(", ")}`)
    }
  }
  return { failures, checkedProjects: projectIds.length > 0 }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = checkPrivateConfig()
    for (const failure of result.failures) console.error(failure)
    if (result.failures.length) process.exitCode = 1
    else
      console.log(
        result.checkedProjects
          ? "PASS current public files: configured project IDs and credential material not found."
          : "PASS credential/path check; private project IDs unavailable, so identifier check was skipped.",
      )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

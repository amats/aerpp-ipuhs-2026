import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { ROOT } from "@aerpp/config/workspace"

// Approved only for Mammoth's unused CLI dependency. Reassess when the path,
// severity, installed version or patch availability changes; see deployment.md.
export function checkReleaseAudit(report, status) {
  assert([0, 1].includes(status), "Dependency audit did not complete")
  assert(report && typeof report === "object" && report.error === undefined)
  assert(
    report.advisories &&
      typeof report.advisories === "object" &&
      !Array.isArray(report.advisories),
  )
  const advisories = Object.values(report.advisories)
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const advisory of advisories) {
    assert(Object.hasOwn(counts, advisory.severity), "Unknown audit severity")
    counts[advisory.severity]++
    assert.equal(
      advisory.github_advisory_id,
      "GHSA-hp3w-g68c-fv3c",
      "Unaccepted dependency advisory",
    )
    assert.equal(advisory.module_name, "sprintf-js")
    assert.equal(advisory.severity, "moderate")
    assert.equal(
      advisory.patched_versions,
      null,
      "A patch is available; review the dependency instead of using the exception",
    )
    assert(Array.isArray(advisory.findings) && advisory.findings.length > 0)
    for (const finding of advisory.findings) {
      assert.equal(finding.version, "1.0.3")
      assert(Array.isArray(finding.paths) && finding.paths.length > 0)
      assert(
        finding.paths.every(
          (path) => path === "apps__web>mammoth>argparse>sprintf-js",
        ),
        "Dependency path exceeds the reviewed CLI scope",
      )
    }
  }
  assert.deepEqual(
    report.metadata?.vulnerabilities,
    counts,
    "Incomplete dependency audit",
  )
  assert.equal(
    status,
    advisories.length === 0 ? 0 : 1,
    "Unexpected audit exit status",
  )
  return advisories.length
}

export function main() {
  const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(result.error, undefined, "Cannot start dependency audit")
  const accepted = checkReleaseAudit(JSON.parse(result.stdout), result.status)
  console.log(
    accepted === 0
      ? "Production dependency audit passed without exceptions."
      : "Production dependency audit passed with the reviewed Mammoth CLI exception (GHSA-hp3w-g68c-fv3c). Recheck before publication.",
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main()
  } catch {
    console.error(
      "Release dependency audit failed: inspect pnpm audit --prod; unreviewed findings and audit errors block acceptance.",
    )
    process.exitCode = 1
  }
}

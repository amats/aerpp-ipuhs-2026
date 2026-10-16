import assert from "node:assert/strict"
import test from "node:test"
import { checkReleaseAudit } from "./check-release-audit.mjs"

const COUNTS = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
const advisory = () => ({
  github_advisory_id: "GHSA-hp3w-g68c-fv3c",
  module_name: "sprintf-js",
  severity: "moderate",
  patched_versions: null,
  findings: [
    { version: "1.0.3", paths: ["apps__web>mammoth>argparse>sprintf-js"] },
  ],
})
const report = () => ({
  advisories: { accepted: advisory() },
  metadata: { vulnerabilities: { ...COUNTS, moderate: 1 } },
})
test("release audit accepts only the reviewed advisory version and CLI dependency path", () => {
  assert.equal(
    checkReleaseAudit(
      { advisories: {}, metadata: { vulnerabilities: COUNTS } },
      0,
    ),
    0,
  )
  assert.equal(checkReleaseAudit(report(), 1), 1)
  for (const change of [
    { github_advisory_id: "GHSA-new" },
    { module_name: "other" },
    { severity: "high" },
    { patched_versions: ">=1.1.4" },
    { findings: [] },
    {
      findings: [
        { version: "1.1.3", paths: ["apps__web>mammoth>argparse>sprintf-js"] },
      ],
    },
    { findings: [{ version: "1.0.3", paths: ["apps__support>sprintf-js"] }] },
    { findings: [{ version: "1.0.3", paths: [] }] },
  ]) {
    const changed = report()
    Object.assign(changed.advisories.accepted, change)
    assert.throws(() => checkReleaseAudit(changed, 1))
  }
})
test("audit errors, omitted findings and unexpected status cannot pass the release gate", () => {
  for (const [value, status] of [
    [report(), null],
    [report(), 2],
    [report(), 0],
    [{ error: "network unavailable" }, 1],
    [
      { advisories: {}, metadata: { vulnerabilities: { ...COUNTS, high: 1 } } },
      1,
    ],
    [{ advisories: {} }, 0],
  ])
    assert.throws(() => checkReleaseAudit(value, status))
  const changed = report()
  changed.advisories.other = { ...advisory(), github_advisory_id: "GHSA-new" }
  assert.throws(() => checkReleaseAudit(changed, 1))
})

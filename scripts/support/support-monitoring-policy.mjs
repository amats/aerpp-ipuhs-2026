import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

export function supportErrorLogFilter(project) {
  assert(
    typeof project === "string" &&
      /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project),
  )
  // Terraform and acceptance use the same source; no deployed filter is trusted
  // merely because its policy has the expected display name.
  return readFileSync(
    new URL(
      "../../infra/terraform/support-error-filter.tftpl",
      import.meta.url,
    ),
    "utf8",
  ).replaceAll(/\$\{project_id\}/g, project)
}

function normalizedFilter(filter) {
  assert(typeof filter === "string")
  // Ignore formatting outside quoted strings, preserving literal match values.
  return filter.replace(/"(?:\\.|[^"\\])*"|\s+/g, (token) =>
    token.startsWith('"') ? token : "",
  )
}

export function assertSupportErrorPolicy(policy, project) {
  assert.equal(policy.combiner, "OR")
  assert(
    Array.isArray(policy.conditions) === true && policy.conditions.length === 1,
  )
  const condition = policy.conditions[0]
  const match = condition.conditionMatchedLog
  assert(
    match &&
      Object.keys(condition).every((key) =>
        ["name", "displayName", "conditionMatchedLog"].includes(key),
      ),
  )
  assert.equal(
    normalizedFilter(match.filter),
    normalizedFilter(supportErrorLogFilter(project)),
  )
  assert.equal(Object.keys(match.labelExtractors ?? {}).length, 0)
  assert.equal(policy.alertStrategy?.notificationRateLimit?.period, "3600s")
  assert.equal(policy.alertStrategy?.autoClose, "1800s")
}

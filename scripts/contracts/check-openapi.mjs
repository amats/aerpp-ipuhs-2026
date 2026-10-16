import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
import { parse } from "yaml"
import { ApiContracts } from "../../packages/contracts/src/participant-api.ts"

const contract = parse(
  readFileSync(
    new URL("../../packages/contracts/src/openapi.yaml", import.meta.url),
    "utf8",
  ),
)
function checkRefs(value) {
  if (!value || typeof value !== "object") return
  if (Object.hasOwn(value, "$ref")) {
    assert.equal(
      typeof value.$ref,
      "string",
      "OpenAPI references must be quoted strings",
    )
    assert(value.$ref.startsWith("#/"), "OpenAPI must be self-contained")
    assert(
      value.$ref
        .slice(2)
        .split("/")
        .reduce((item, key) => item?.[key], contract),
      `Unresolved reference: ${value.$ref}`,
    )
  }
  for (const nested of Object.values(value)) checkRefs(nested)
}
checkRefs(contract)
for (const [operation, api] of Object.entries(ApiContracts)) {
  assert.equal(
    SUPPORT_ROUTES[operation],
    api.path,
    `Route contract drift: ${operation}`,
  )
  assert(
    contract.paths[api.path]?.[api.method.toLowerCase()],
    `OpenAPI method drift: ${operation}`,
  )
}
for (const path of Object.values(SUPPORT_ROUTES)) {
  assert(contract.paths[path], `Missing Support route: ${path}`)
  for (const operation of Object.values(contract.paths[path])) {
    assert.deepEqual(
      operation.security,
      path === "/email/confirm" ? [] : [{ callerCredential: [] }],
      `Unexpected route security: ${path}`,
    )
  }
}
for (const path of [
  "/maintenance/withdrawal-cleanup",
  "/maintenance/mail-health",
])
  assert.deepEqual(contract.paths[path].post.security, [{ schedulerOidc: [] }])
assert.equal(
  contract.components.securitySchemes.callerCredential.scheme,
  "bearer",
)
console.log(
  "Support runtime/API/OpenAPI routes, local references and security passed.",
)

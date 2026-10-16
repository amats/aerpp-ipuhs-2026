import assert from "node:assert/strict"
import { test } from "node:test"
import { assertServiceOwnership } from "./service-ownership.mjs"

test("Admin ownership uses Terraform revision labels and rejects missing or conflicting ownership", () => {
  for (const environment of ["test", "production"]) {
    const labels = {
      "aerpp-component": "admin",
      "aerpp-environment": environment,
    }
    const service = { spec: { template: { metadata: { labels } } } }
    assertServiceOwnership(service, environment)
    assertServiceOwnership({ ...service, metadata: { labels } }, environment)
    assert.throws(() =>
      assertServiceOwnership(
        service,
        environment === "test" ? "production" : "test",
      ),
    )
    assert.throws(() =>
      assertServiceOwnership({ metadata: { labels } }, environment),
    )
    for (const conflict of [
      { "aerpp-component": "support" },
      { "aerpp-environment": "other" },
    ])
      assert.throws(() =>
        assertServiceOwnership(
          { ...service, metadata: { labels: conflict } },
          environment,
        ),
      )
  }
  assert.throws(() => assertServiceOwnership({}, "production"))
})

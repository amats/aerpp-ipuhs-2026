import assert from "node:assert/strict"
import { test } from "node:test"
import { runTerraformInfrastructure } from "./terraform.mjs"

test("invalid infrastructure commands fail before resolving an environment or contacting cloud", () => {
  for (const args of [
    ["invalid", "apply"],
    ["test", "destroy"],
    ["test", "plan", "extra"],
  ])
    assert.throws(() => runTerraformInfrastructure(args), /Usage:/)
})

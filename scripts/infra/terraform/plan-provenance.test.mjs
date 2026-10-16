import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  assertPlanProvenance,
  foundationSourceFingerprint,
} from "./plan-provenance.mjs"

const PROJECT = "synthetic-test-project"
const REGION = "asia-northeast1"

test("saved plans are bound to reviewed input, HCL, provider lock and plan bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-plan-provenance-"))
  try {
    writeFileSync(join(directory, "main.tf"), "# original")
    writeFileSync(
      join(directory, "support-error-filter.tftpl"),
      "original filter",
    )
    writeFileSync(join(directory, ".terraform.lock.hcl"), "# original lock")
    const inputs = { project_id: PROJECT, region: REGION }
    const backend = { bucket: "synthetic-bucket", prefix: "support/foundation" }
    const fingerprint = () =>
      foundationSourceFingerprint(directory, inputs, backend)
    const planBytes = Buffer.from("synthetic plan")
    const record = {
      sourceFingerprint: fingerprint(),
      planSha256: createHash("sha256").update(planBytes).digest("hex"),
    }
    assert.doesNotThrow(() =>
      assertPlanProvenance(record, fingerprint(), planBytes),
    )
    assert.throws(() =>
      assertPlanProvenance(
        record,
        fingerprint(),
        Buffer.from("different plan"),
      ),
    )
    inputs.region = "us-central1"
    assert.throws(() => assertPlanProvenance(record, fingerprint(), planBytes))
    inputs.region = REGION
    writeFileSync(join(directory, ".terraform.lock.hcl"), "# changed lock")
    assert.throws(() => assertPlanProvenance(record, fingerprint(), planBytes))
    writeFileSync(join(directory, ".terraform.lock.hcl"), "# original lock")
    writeFileSync(
      join(directory, "support-error-filter.tftpl"),
      "changed filter",
    )
    assert.throws(() => assertPlanProvenance(record, fingerprint(), planBytes))
    writeFileSync(
      join(directory, "support-error-filter.tftpl"),
      "original filter",
    )
    writeFileSync(join(directory, "main.tf"), "# changed source")
    assert.throws(() => assertPlanProvenance(record, fingerprint(), planBytes))
    writeFileSync(join(directory, "unexpected.auto.tfvars.json"), "{}")
    assert.throws(fingerprint, /outside the module/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

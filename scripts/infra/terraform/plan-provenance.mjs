import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export function foundationSourceFingerprint(directory, inputs, backend) {
  const files = readdirSync(directory).sort()
  if (files.some((name) => /\.tfvars(?:\.json)?$/.test(name)))
    throw new Error(
      "Terraform variable files must be generated outside the module",
    )
  const sources = files.filter(
    (name) =>
      /\.(?:tf(?:\.json)?|tftpl)$/.test(name) || name === ".terraform.lock.hcl",
  )
  return createHash("sha256")
    .update(
      JSON.stringify({
        inputs,
        backend,
        sources: sources.map((name) => [
          name,
          readFileSync(resolve(directory, name), "utf8"),
        ]),
      }),
    )
    .digest("hex")
}

export function assertPlanProvenance(record, sourceFingerprint, planBytes) {
  if (
    record?.sourceFingerprint !== sourceFingerprint ||
    record?.planSha256 !== createHash("sha256").update(planBytes).digest("hex")
  )
    throw new Error(
      "Terraform inputs, source or saved plan changed; create and review a new plan",
    )
}

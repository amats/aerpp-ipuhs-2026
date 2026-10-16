import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { privateJson } from "../../shared/delivery.mjs"
import { assertRecoveryPlan, recoveryTargets } from "../firestore-recovery.mjs"
import { assertFoundationPlan } from "./plan-policy.mjs"
import { assertPlanProvenance } from "./plan-provenance.mjs"

export function reviewSavedTerraformPlan({
  action,
  recoveryMode,
  directory,
  inputs,
  sourceFingerprint,
  project,
  region,
  invoke,
}) {
  const variables = resolve(directory, "terraform.tfvars.json")
  privateJson(variables, inputs)
  const planFile = resolve(directory, "foundation.tfplan")
  const provenanceFile = resolve(directory, "plan-provenance.json")
  if (action === "plan") {
    invoke([
      "plan",
      "-input=false",
      "-no-color",
      `-var-file=${variables}`,
      ...(recoveryMode === undefined
        ? []
        : recoveryTargets(recoveryMode).map((address) => `-target=${address}`)),
      `-out=${planFile}`,
    ])
    privateJson(provenanceFile, {
      _comment: "Generated plan provenance; do not edit",
      sourceFingerprint,
      planSha256: createHash("sha256")
        .update(readFileSync(planFile))
        .digest("hex"),
    })
  }
  if (!existsSync(planFile))
    throw new Error("Create and review the selected infrastructure plan first")
  if (!existsSync(provenanceFile))
    throw new Error(
      "Create a new plan with input/source provenance before applying",
    )
  assertPlanProvenance(
    JSON.parse(readFileSync(provenanceFile, "utf8")),
    sourceFingerprint,
    readFileSync(planFile),
  )
  const plan = JSON.parse(invoke(["show", "-json", planFile], true))
  if (recoveryMode === undefined) assertFoundationPlan(plan, project, region)
  else
    assertRecoveryPlan(
      plan,
      project,
      region,
      recoveryMode,
      assertFoundationPlan,
    )
  privateJson(resolve(directory, "plan.json"), plan)
  return { plan, planFile }
}

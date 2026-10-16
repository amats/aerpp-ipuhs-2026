import { resolve } from "node:path"
import { writeSupportTerraformSettings } from "@aerpp/config/auto-settings"
import { parseSupportTerraformOutputs } from "@aerpp/config/terraform"
import { privateJson } from "../../shared/delivery.mjs"

export function exportTerraformOutputs({
  invoke,
  target,
  region,
  metadata,
  configurationDirectory,
  directory,
  sourceFingerprint,
}) {
  const outputs = JSON.parse(invoke(["output", "-json"], true))
  const foundation = parseSupportTerraformOutputs(outputs, target, region)
  if (
    foundation.serviceEndpoint &&
    foundation.serviceEndpoint.projectNumber !== String(metadata.projectNumber)
  )
    throw new Error("Terraform service endpoint project number mismatch")
  writeSupportTerraformSettings(configurationDirectory, target, foundation)
  privateJson(resolve(directory, "outputs.json"), {
    _comment:
      "Generated from applied Terraform state; do not edit. Not a live drift check.",
    exportedAt: new Date().toISOString(),
    sourceFingerprint,
    foundation,
  })
}

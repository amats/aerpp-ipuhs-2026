import { deriveInfrastructure } from "@aerpp/config/infrastructure"
import { decodeManualConfig } from "@aerpp/config/manual-config"
import { deriveSupportTerraformInputs } from "@aerpp/config/terraform"

export function assertSetupConfiguration(
  config,
  target,
  configurationDirectory,
) {
  if (config.projectId !== target.project)
    throw new Error("Initial environment setup target mismatch")
  if (
    config.support?.admissionOpen !== false ||
    config.support?.maintenanceEnabled !== false ||
    config.support?.local !== undefined
  )
    throw new Error(
      "Initial cloud setup requires closed admission/maintenance and no local Support settings",
    )
  const operator = config.infrastructure?.operatorAccount
  if (
    typeof operator !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator) ||
    /@example\.invalid$/i.test(operator) ||
    /^(YOUR_|replace[-_ ]with)/i.test(operator)
  )
    throw new Error(
      "Complete infrastructure.operatorAccount before cloud setup",
    )
  if (
    /@example\.invalid$/i.test(
      config.infrastructure?.monitoring?.notificationEmail ?? "",
    )
  )
    throw new Error(
      "Replace infrastructure.monitoring.notificationEmail before cloud setup",
    )
  deriveSupportTerraformInputs(config, target)
  deriveInfrastructure(
    decodeManualConfig(config),
    target,
    configurationDirectory,
  )
}

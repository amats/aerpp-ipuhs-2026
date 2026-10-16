import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { hostedAdminEnvironment } from "@aerpp/config/admin-deployment"
import { deriveInfrastructure } from "@aerpp/config/infrastructure"
import { deriveSupportTerraformInputs } from "@aerpp/config/terraform"
import { prepareApplicationRuntime } from "@aerpp/config/workspace"
import { adminSecretNames } from "../../admin/secret-names.mjs"
import { assertMailAdmission } from "../../support/support-update-policy.mjs"

export function buildTerraformInputs(
  config,
  target,
  configurationDirectory,
  output,
) {
  const { name: environment, project } = target
  const inputs = deriveSupportTerraformInputs(config, target)
  {
    const prepared = resolve(output, "admin-prepared.json")
    const deployed = resolve(output, "admin-deployed.json")
    const acceptedFile = existsSync(prepared) ? prepared : deployed
    const deployment = deriveInfrastructure(
      config,
      target,
      configurationDirectory,
    ).deployment
    const secretRefs = Object.fromEntries(
      Object.entries(adminSecretNames(deployment)).map(([key, secret]) => [
        key,
        { secret },
      ]),
    )
    inputs.admin = {
      service: deployment.service,
      repository: deployment.repository,
      account_id: deployment.serviceAccountId,
      max_instances: deployment.maxInstances,
      secret_refs: secretRefs,
    }
    if (existsSync(acceptedFile)) {
      const accepted = JSON.parse(readFileSync(acceptedFile))
      const { values } = prepareApplicationRuntime(
        environment,
        configurationDirectory,
        { apps: "admin" },
      )
      const { runtime } = hostedAdminEnvironment(
        values.admin,
        accepted.url,
        environment,
      )
      if (
        accepted.project !== project ||
        accepted.environment !== environment ||
        !isDeepStrictEqual(runtime, accepted.runtime) ||
        !isDeepStrictEqual(deployment, accepted.deployment)
      )
        throw new Error(
          "Admin preparation must match the selected private configuration",
        )
      for (const [key, value] of Object.entries(accepted.versions)) {
        const [secret, version] = value.split(":")
        if (
          !/^[1-9][0-9]*$/.test(version) ||
          secret !== secretRefs[key]?.secret
        )
          throw new Error("Invalid accepted Admin secret reference")
        secretRefs[key].version = version
      }
      inputs.admin = {
        ...inputs.admin,
        image: accepted.digestImage,
        revision: accepted.trafficRevision ?? accepted.revision ?? null,
        runtime,
      }
    }
  }
  const { serviceAccounts } = deriveInfrastructure(
    config,
    target,
    configurationDirectory,
  )
  inputs.local_admin_account = serviceAccounts.localAdmin
  inputs.logging_account = serviceAccounts.logging
  inputs.operator_account = config.infrastructure.operatorAccount
  const { region } = inputs
  const deploymentFile = resolve(output, "support-deployment.json")
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"))
    const prefix = `${region}-docker.pkg.dev/${project}/aerpp-support/support@sha256:`
    if (
      deployment.project !== project ||
      deployment.region !== region ||
      !deployment.image?.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/.test(deployment.image.slice(prefix.length)) ||
      !/^[1-9][0-9]*$/.test(deployment.runtimeVersion)
    )
      throw new Error("Invalid prepared support deployment")
    const { values } = prepareApplicationRuntime(
      environment,
      configurationDirectory,
      { apps: "support" },
    )
    const runtime = JSON.parse(values.support.SUPPORT_RUNTIME_JSON)
    if (runtime.admissionOpen === true) {
      const acceptance = JSON.parse(
        readFileSync(
          resolve(output, "support-mail-admission-baseline.json"),
          "utf8",
        ),
      )
      assertMailAdmission(runtime, acceptance, deployment.image)
    }
    if (
      createHash("sha256")
        .update(values.support.SUPPORT_RUNTIME_JSON)
        .digest("hex") !== deployment.runtimeSha256
    )
      throw new Error(
        "Support runtime changed; prepare a new validated deployment",
      )
    inputs.deployment = {
      image: deployment.image,
      runtime_version: deployment.runtimeVersion,
      maintenance_enabled: runtime.maintenanceEnabled,
    }
  }
  return inputs
}

import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readAutoSettings } from "@aerpp/config/auto-settings"
import { readSupportEnvironment } from "@aerpp/config/support"
import { validateSupportFoundation } from "@aerpp/config/terraform"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import { resolveDeploymentImage } from "../admin/prepare-admin-deployment.mjs"
import { main as pruneSecrets } from "../cloud/prune-secrets.mjs"
import { prepareSecretVersion } from "../cloud/secret-versions.mjs"
import {
  cli,
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
  run,
  toolEnvironment,
} from "../shared/delivery.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "../shared/source-provenance.mjs"
import {
  assertMailAdmission,
  selectMailAdmissionEvidence,
} from "./support-update-policy.mjs"

export function assertPreparation(
  runtime,
  manifest,
  checked,
  inspection,
  acceptance,
  deployedImage,
) {
  if (!["test", "production"].includes(runtime.environment))
    throw new Error("Preparation requires a selected cloud environment")
  assertImageSource(manifest, inspection)
  assertMatchingSource(checked, manifest)
  assertMailAdmission(runtime, acceptance, deployedImage)
  if (
    manifest.environment !== runtime.environment ||
    checked.imageId !== manifest.imageId ||
    checked.network !== "none" ||
    checked.publicPages !== true ||
    checked.protectedRoutes !== true ||
    checked.missingConfigurationRejected !== true ||
    inspection.Os !== "linux" ||
    inspection.Architecture !== "amd64" ||
    inspection.Config?.User !== "node"
  )
    throw new Error("Build and verify the support image before preparation")
}

export function main(args = process.argv.slice(2)) {
  const [environment, action, ...extra] = args
  if (
    !["test", "production"].includes(environment) ||
    action !== "--apply" ||
    extra.length
  )
    throw new Error(
      "Usage: support:prepare-deployment test|production --apply (pushes image and writes a secret version)",
    )
  const directory = environmentDirectory(environment)
  const { target, values } = prepareApplicationRuntime(environment, directory, {
    apps: "support",
  })
  const runtime = readSupportEnvironment(values.support)
  const config = readJson(
    resolve(directory, "config.json"),
    "Selected environment configuration",
  )
  const automatic = readAutoSettings(directory, target)
  const foundation = validateSupportFoundation(
    automatic.terraform?.support,
    target,
    config.infrastructure.region,
  )
  const output = outputDirectory(environment)
  const manifest = readJson(
    resolve(output, "support-image.json"),
    "Image evidence",
  )
  const checked = readJson(
    resolve(output, "support-image-check.json"),
    "Container check evidence",
  )
  const inspection = JSON.parse(
    run("docker", ["image", "inspect", manifest.imageId]),
  )[0]
  const acceptanceFile = resolve(output, "support-mail-admission-baseline.json")
  const deployedImage = runtime.admissionOpen
    ? readJson(
        resolve(output, "support-deployment.json"),
        "Previous deployment",
      ).image
    : undefined
  const baseline =
    runtime.admissionOpen && existsSync(acceptanceFile)
      ? readJson(acceptanceFile, "Mail admission baseline")
      : undefined
  const current =
    runtime.admissionOpen && baseline?.cloud?.image !== deployedImage
      ? Object.fromEntries(
          ["cloud", "data", "scheduler"].map((key) => [
            key,
            readJson(
              resolve(output, `support-${key}-check.json`),
              "Acceptance",
            ),
          ]),
        )
      : undefined
  const acceptance = runtime.admissionOpen
    ? selectMailAdmissionEvidence(runtime, baseline, current, deployedImage)
    : undefined
  assertPreparation(
    runtime,
    manifest,
    checked,
    inspection,
    acceptance,
    deployedImage,
  )
  assertMatchingSource(manifest, readSourceState())
  // Verify the container exists before uploading; values never enter Terraform.
  gcloud(target.project, [
    "secrets",
    "describe",
    "SUPPORT_RUNTIME_JSON",
    "--format=value(name)",
  ])
  const temporary = mkdtempSync(resolve(tmpdir(), "aerpp-support-push-"))
  try {
    const registry = `${foundation.region}-docker.pkg.dev`
    const repository = `${registry}/${target.project}/aerpp-support/support`
    const remote = `${repository}:prepared-${Date.now()}`
    const env = { ...toolEnvironment(), DOCKER_CONFIG: temporary }
    writeFileSync(resolve(temporary, "config.json"), '{"auths":{}}\n', {
      mode: 0o600,
    })
    run(
      "docker",
      [
        "login",
        "-u",
        "oauth2accesstoken",
        "--password-stdin",
        `https://${registry}`,
      ],
      {
        env,
        input: gcloud(target.project, ["auth", "print-access-token"]),
      },
    )
    run("docker", ["tag", manifest.imageId, remote], { env })
    run("docker", ["push", remote], {
      env,
      log: resolve(output, "support-push.log"),
    })
    const pushed = JSON.parse(
      run("docker", ["image", "inspect", remote], { env }),
    )[0]
    const reference = pushed.RepoDigests?.find((value) =>
      value.startsWith(`${repository}@sha256:`),
    )
    if (!reference) throw new Error("Missing immutable pushed image reference")
    const image = resolveDeploymentImage(reference, manifest.imageId, (ref) =>
      JSON.parse(run("docker", ["manifest", "inspect", ref], { env })),
    )
    if (runtime.admissionOpen && image !== deployedImage)
      throw new Error("Admission must retain the accepted image")
    if (runtime.admissionOpen && acceptance !== baseline) {
      if (baseline)
        privateJson(
          resolve(output, `support-mail-admission-baseline-${Date.now()}.json`),
          baseline,
        )
      privateJson(acceptanceFile, acceptance)
    }
    const runtimeJson = values.support.SUPPORT_RUNTIME_JSON
    const runtimeVersion = prepareSecretVersion(
      target.project,
      "SUPPORT_RUNTIME_JSON",
      runtimeJson,
      output,
    )
    privateJson(resolve(output, "support-deployment.json"), {
      _comment: "Generated immutable preparation inputs; do not edit",
      project: target.project,
      region: foundation.region,
      image,
      runtimeVersion,
      imageId: manifest.imageId,
      ...sourceProvenance(manifest),
      runtimeSha256: createHash("sha256").update(runtimeJson).digest("hex"),
      preparedAt: new Date().toISOString(),
    })
    pruneSecrets([environment, "--apply"], "support")
    console.log(
      "Verified image pushed and validated runtime snapshot stored. Review a new Terraform plan before applying.",
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = cli(() => main())

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  adminServiceUrl,
  hostedAdminEnvironment,
  readAdminDeployment,
} from "@aerpp/config/admin-deployment"
import { environmentTarget } from "@aerpp/config/targets"
import {
  environmentDirectory,
  prepareApplicationRuntime,
  validateTargetValues,
} from "@aerpp/config/workspace"
import { main as pruneSecrets } from "../cloud/prune-secrets.mjs"
import { prepareSecretVersion } from "../cloud/secret-versions.mjs"
import {
  cli,
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
  run,
  toolEnvironment,
} from "../shared/delivery.mjs"
import { runtimeFingerprint } from "../shared/runtime-fingerprint.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "../shared/source-provenance.mjs"
import { adminSecretNames } from "./secret-names.mjs"
import { assertServiceOwnership } from "./service-ownership.mjs"

export function validateImage(manifest, inspection, target) {
  assertImageSource(manifest, inspection)
  if (
    manifest.version !== 1 ||
    manifest.environment !== target.name ||
    manifest.project !== target.project ||
    manifest.platform !== "linux/amd64" ||
    inspection.Architecture !== "amd64" ||
    inspection.Os !== "linux" ||
    inspection.Config?.Labels?.["io.aerpp.environment"] !== target.name
  )
    throw new Error(
      "Admin image identity, platform or project mismatch; rebuild for the selected environment",
    )
}
export function resolveDeploymentImage(reference, imageId, inspect) {
  const repository = reference.split("@")[0]
  let document = inspect(reference)
  let selected = reference
  if (Array.isArray(document.manifests)) {
    const matches = document.manifests.filter(
      (entry) =>
        entry.platform?.os === "linux" &&
        entry.platform?.architecture === "amd64",
    )
    if (
      matches.length !== 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? "")
    )
      throw new Error(
        "Registry image must contain exactly one linux/amd64 manifest",
      )
    selected = `${repository}@${matches[0].digest}`
    document = inspect(selected)
  }
  // Docker's containerd image store identifies images by manifest/index digest;
  // the classic store reports the configuration digest instead.
  if (
    !/^sha256:[a-f0-9]{64}$/.test(document.config?.digest ?? "") ||
    (reference.split("@")[1] !== imageId && document.config.digest !== imageId)
  )
    throw new Error("Registry image does not match the checked local image")
  return selected
}

export function main(args = process.argv.slice(2)) {
  const [environment, ...extra] = args
  cloudEnvironment(environment)
  if (extra.length)
    throw new Error("Usage: admin:prepare-terraform test|production")
  const cloudTarget = environmentTarget(environment)
  const deployment = readAdminDeployment(environment)
  const services = JSON.parse(
    gcloud(cloudTarget.project, [
      "run",
      "services",
      "list",
      `--region=${deployment.region}`,
      "--format=json",
    ]),
  )
  const { target, values } = prepareApplicationRuntime(
    environment,
    environmentDirectory(environment),
    { apps: "admin" },
  )
  validateTargetValues(target, values)
  const output = outputDirectory(environment)
  const manifest = readJson(
    resolve(output, "admin-image.json"),
    "Admin image manifest",
  )
  const inspection = JSON.parse(
    run("docker", ["image", "inspect", manifest.imageId]),
  )[0]
  validateImage(manifest, inspection, target)
  assertMatchingSource(manifest, readSourceState())
  const projectNumber = gcloud(target.project, [
    "projects",
    "describe",
    target.project,
    "--format=value(projectNumber)",
  ])
  const url = adminServiceUrl(deployment, projectNumber)
  const { runtime, secrets } = hostedAdminEnvironment(
    values.admin,
    url,
    environment,
  )
  const plan = {
    version: 1,
    environment,
    project: target.project,
    deployment,
    imageId: manifest.imageId,
    ...sourceProvenance(manifest),
    serviceAccount: `${deployment.serviceAccountId}@${target.project}.iam.gserviceaccount.com`,
    url,
    callbackUrl: `${url}/api/auth/callback/google`,
    runtime,
    runtimeSha256: runtimeFingerprint({ ...runtime, ...secrets }),
    secrets: adminSecretNames(deployment),
    createdAt: new Date().toISOString(),
  }
  privateJson(resolve(output, "admin-deploy-plan.json"), plan)
  const checked = readJson(
    resolve(output, "admin-image-check.json"),
    "Admin image check result; run admin:check-image first",
  )
  if (
    checked.imageId !== manifest.imageId ||
    checked.environment !== environment ||
    checked.ok !== true
  )
    throw new Error("Admin image has not passed local verification")
  assertMatchingSource(checked, manifest)
  const previous = services.find((s) => s.metadata?.name === deployment.service)
  if (previous) assertServiceOwnership(previous, environment)
  if (previous)
    privateJson(resolve(output, `admin-before-${Date.now()}.json`), previous)
  const temporary = mkdtempSync(resolve(tmpdir(), "aerpp-admin-deploy-"))
  try {
    const versions = {}
    for (const [key, name] of Object.entries(plan.secrets)) {
      const version = prepareSecretVersion(
        target.project,
        name,
        secrets[key],
        output,
      )
      versions[key] = `${name}:${version}`
    }
    const registry = `${deployment.region}-docker.pkg.dev`
    const repository = `${registry}/${target.project}/${deployment.repository}/admin`
    const remote = `${repository}:${manifest.image.split(":").at(-1)}`
    const env = { ...toolEnvironment(), DOCKER_CONFIG: temporary }
    writeFileSync(resolve(temporary, "config.json"), '{"auths":{}}\n', {
      mode: 0o600,
    })
    const token = gcloud(target.project, ["auth", "print-access-token"])
    run(
      "docker",
      [
        "login",
        "-u",
        "oauth2accesstoken",
        "--password-stdin",
        `https://${registry}`,
      ],
      { env, input: token },
    )
    run("docker", ["tag", manifest.imageId, remote], { env })
    console.log(`Pushing verified ${environment} Admin image`)
    run("docker", ["push", remote], {
      env,
      log: resolve(output, "admin-push.log"),
    })
    const pushed = JSON.parse(
      run("docker", ["image", "inspect", remote], { env }),
    )[0]
    const pushedReference = pushed.RepoDigests?.find((value) =>
      value.startsWith(`${repository}@sha256:`),
    )
    if (!pushedReference || !/@sha256:[a-f0-9]{64}$/.test(pushedReference))
      throw new Error("Cannot determine pushed Admin image digest")
    // BuildKit may publish an index containing an image and attestations.
    // Cloud Run resolves that index to the platform manifest it actually runs.
    const digestImage = resolveDeploymentImage(
      pushedReference,
      manifest.imageId,
      (reference) =>
        JSON.parse(run("docker", ["manifest", "inspect", reference], { env })),
    )
    const traffic = previous?.status?.traffic
    if (
      previous &&
      (traffic?.length !== 1 ||
        traffic[0].percent !== 100 ||
        !traffic[0].revisionName)
    )
      throw new Error(
        "Terraform preparation requires one existing serving Admin revision",
      )
    privateJson(resolve(output, "admin-prepared.json"), {
      ...plan,
      digestImage,
      versions,
      trafficRevision: traffic?.[0]?.revisionName ?? null,
      preparedAt: new Date().toISOString(),
    })
    pruneSecrets([environment, "--apply"], "admin")
    console.log(
      "Admin image and immutable secret references prepared; review and apply the selected Terraform plan.",
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = cli(() => main())

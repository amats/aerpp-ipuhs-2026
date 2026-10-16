import { isDeepStrictEqual } from "node:util"
import { gcloud } from "../shared/delivery.mjs"
import { protectedRevisionNames } from "./run-revisions.mjs"

export function assertImageCleanupPolicies(value, pins) {
  if (
    !Array.isArray(pins) ||
    pins.some((pin) => !/^sha256:[a-f0-9]{64}$/.test(pin))
  )
    throw new Error("Missing validated image retention pins")
  const condition = {
    newer_than: "",
    older_than: "",
    package_name_prefixes: [],
    tag_prefixes: [],
    tag_state: "ANY",
    version_name_prefixes: [],
  }
  const expected = [
    {
      id: "delete-old",
      action: "DELETE",
      condition: [{ ...condition, older_than: "86400s" }],
      most_recent_versions: [],
    },
    {
      id: "keep-recent",
      action: "KEEP",
      condition: [],
      most_recent_versions: [{ keep_count: 1, package_name_prefixes: [] }],
    },
    ...(pins.length
      ? [
          {
            id: "keep-deployed",
            action: "KEEP",
            condition: [
              {
                ...condition,
                version_name_prefixes: [
                  ...new Set(pins.map((pin) => pin.slice(0, 64))),
                ].sort(),
              },
            ],
            most_recent_versions: [],
          },
        ]
      : []),
  ]
  const actual = structuredClone(value.cleanup_policies ?? [])
  for (const policy of actual)
    for (const item of policy.condition ?? []) {
      item.version_name_prefixes?.sort()
      item.newer_than ??= ""
      item.older_than ??= ""
    }
  const byId = (a, b) => a.id.localeCompare(b.id)
  if (
    value.cleanup_policy_dry_run !== false ||
    !isDeepStrictEqual(actual.sort(byId), expected.sort(byId))
  )
    throw new Error(
      "Repository cleanup must keep the latest generation and every protected digest",
    )
}

export function retainedDigests(
  services,
  revisions,
  repository,
  prepared = [],
) {
  const belongsToRepository = (image) =>
    typeof image === "string" &&
    (image === repository ||
      image.startsWith(`${repository}:`) ||
      image.startsWith(`${repository}@`))
  const selected = services.filter(
    (service) =>
      service.spec?.template?.spec?.containers?.some((container) =>
        belongsToRepository(container.image),
      ) === true ||
      revisions.some(
        (revision) =>
          revision.metadata?.labels?.["serving.knative.dev/service"] ===
            service.metadata?.name &&
          belongsToRepository(revision.status?.imageDigest) === true,
      ) === true,
  )
  const names = new Set(selected.map((service) => service.metadata.name))
  const protectedNames = new Set(selected.flatMap(protectedRevisionNames))
  for (const name of names) {
    const ready = revisions
      .filter(
        (revision) =>
          revision.metadata?.labels?.["serving.knative.dev/service"] === name &&
          revision.status?.conditions?.some(
            (condition) =>
              condition.type === "Ready" && condition.status === "True",
          ),
      )
      .sort(
        (a, b) =>
          Date.parse(b.metadata.creationTimestamp) -
          Date.parse(a.metadata.creationTimestamp),
      )
    for (const revision of ready.slice(0, 1))
      protectedNames.add(revision.metadata.name)
  }
  const references = [...prepared]
  for (const name of protectedNames) {
    const revision = revisions.find((item) => item.metadata.name === name)
    if (!revision)
      throw new Error("Cannot resolve a protected Cloud Run revision")
    references.push(revision.status?.imageDigest)
  }
  return [
    ...new Set(
      references.map((reference) => {
        if (
          typeof reference !== "string" ||
          !reference.startsWith(`${repository}@sha256:`) ||
          !/^[a-f0-9]{64}$/.test(reference.split("@sha256:")[1])
        )
          throw new Error(
            "Protected image must be an immutable digest in the selected repository",
          )
        return reference.split("@")[1]
      }),
    ),
  ].sort()
}

export function collectImageRetentionPins(
  project,
  region,
  admin,
  deployment,
  execute = gcloud,
) {
  const services = JSON.parse(
    execute(project, [
      "run",
      "services",
      "list",
      `--region=${region}`,
      "--format=json",
    ]),
  )
  const revisions = JSON.parse(
    execute(project, [
      "run",
      "revisions",
      "list",
      `--region=${region}`,
      "--format=json",
    ]),
  )
  const base = `${region}-docker.pkg.dev/${project}`
  return {
    support: retainedDigests(
      services,
      revisions,
      `${base}/aerpp-support/support`,
      deployment?.image ? [deployment.image] : [],
    ),
    admin: retainedDigests(
      services,
      revisions,
      `${base}/${admin.repository}/admin`,
      admin.image ? [admin.image] : [],
    ),
  }
}

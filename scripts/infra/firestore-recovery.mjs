import { isDeepStrictEqual } from "node:util"

export const TTL_RECOVERY_FIELDS = new Map([
  [
    'google_firestore_field.existing["emailConfirmations/expireAt"]',
    "emailConfirmations",
  ],
  ['google_firestore_field.existing["information/expireAt"]', "information"],
  [
    'google_firestore_field.support_rate_limits["expireAt"]',
    "supportRateLimits",
  ],
])

export function recoveryTargets(mode) {
  if (!["close-admission", "recover-fields"].includes(mode))
    throw new Error("Select a supported Firestore recovery operation")
  if (mode === "close-admission")
    return ["google_cloud_run_v2_service.support[0]"]
  return [
    "google_firestore_field.existing",
    "google_firestore_field.support_rate_limits",
    "google_firestore_index.existing",
  ]
}

export function assertTtlRestoration(resource, project) {
  const collection = TTL_RECOVERY_FIELDS.get(resource.address)
  const { before, after, actions, importing } = resource.change
  const { ttl_config: beforeTtl, ...beforeSettings } = before ?? {}
  const { ttl_config: afterTtl, ...afterSettings } = after ?? {}
  if (
    collection === undefined ||
    actions.join() !== "update" ||
    importing !== undefined ||
    before?.project !== project ||
    before?.database !== "(default)" ||
    before?.collection !== collection ||
    before?.field !== "expireAt" ||
    Array.isArray(beforeTtl) !== true ||
    beforeTtl.length !== 0 ||
    Array.isArray(afterTtl) !== true ||
    afterTtl.length !== 1 ||
    Object.entries(afterTtl[0]).some(
      ([key, value]) =>
        !["state", "expiration_offset"].includes(key) || value !== null,
    ) ||
    isDeepStrictEqual(beforeSettings, afterSettings) !== true
  )
    throw new Error(
      "TTL recovery may only re-enable a removed expiry policy without changing field indexes or identity",
    )
}

export function assertRecoveryPlan(
  plan,
  project,
  region,
  mode,
  assertFoundation,
) {
  if (
    plan.errored === true ||
    plan.variables?.project_id?.value !== project ||
    plan.variables?.region?.value !== region
  )
    throw new Error("Firestore recovery plan target mismatch")
  for (const resource of plan.resource_changes ?? []) {
    const actions = resource.change.actions.join()
    if (["no-op", "read"].includes(actions)) {
      assertFoundation(
        { ...plan, resource_changes: [resource] },
        project,
        region,
      )
    } else if (
      mode === "close-admission" &&
      resource.address === "google_cloud_run_v2_service.support[0]"
    ) {
      assertFoundation(
        { ...plan, resource_changes: [resource] },
        project,
        region,
      )
    } else if (
      mode === "recover-fields" &&
      TTL_RECOVERY_FIELDS.has(resource.address) &&
      actions === "update"
    ) {
      assertTtlRestoration(resource, project)
    } else if (
      mode === "recover-fields" &&
      actions === "create" &&
      (resource.address.startsWith("google_firestore_field.existing[") ||
        resource.address.startsWith(
          "google_firestore_field.support_rate_limits[",
        ) ||
        resource.address.startsWith("google_firestore_index.existing["))
    ) {
      assertFoundation(
        { ...plan, resource_changes: [resource] },
        project,
        region,
      )
    } else {
      throw new Error("Firestore recovery must not change other infrastructure")
    }
  }
}

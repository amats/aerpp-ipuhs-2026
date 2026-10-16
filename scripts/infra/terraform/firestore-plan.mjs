import { isDeepStrictEqual } from "node:util"

export function assertFirestorePlanResource(resource, plan, project) {
  if (
    resource.address.startsWith("google_firestore_index.existing[") ||
    resource.address.startsWith("google_firestore_field.existing[")
  ) {
    const value = resource.change.after
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      !plan.variables?.firestore?.value?.manage_existing_indexes ||
      value?.database !== "(default)" ||
      (resource.change.importing &&
        !resource.change.importing.id.startsWith(
          `projects/${project}/databases/(default)/collectionGroups/`,
        ))
    )
      throw new Error(
        "Firestore indexes and fields permit creation or no-op only",
      )
  }
  if (
    resource.address === 'google_firestore_backup_schedule.daily["default"]'
  ) {
    const value = resource.change.after
    const settings = plan.variables?.firestore?.value
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      settings?.automatic_backups !== true ||
      !Number.isInteger(settings.backup_retention_days) ||
      settings.backup_retention_days < 1 ||
      settings.backup_retention_days > 98 ||
      value?.database !== "(default)" ||
      value?.retention !== `${settings.backup_retention_days * 86400}s` ||
      value?.deletion_policy !== "PREVENT" ||
      !isDeepStrictEqual(value?.daily_recurrence, [{}]) ||
      (value?.weekly_recurrence?.length ?? 0) !== 0 ||
      resource.change.importing
    )
      throw new Error(
        "Firestore backup schedule permits creation or no-op with the selected daily retention only",
      )
  }
  if (resource.address === 'google_firestore_database.primary["default"]') {
    const value = resource.change.after
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      value?.name !== "(default)" ||
      value?.location_id !== plan.variables?.firestore?.value?.location ||
      value?.type !== "FIRESTORE_NATIVE" ||
      value?.deletion_policy !== "ABANDON" ||
      (resource.change.importing &&
        resource.change.importing.id !==
          `projects/${project}/databases/(default)`)
    )
      throw new Error("Firestore database permits creation or no-op only")
  }
  if (
    resource.address.startsWith("google_firestore_field.support_rate_limits[")
  ) {
    const after = resource.change.after
    const field = resource.address.endsWith('["expireAt"]') ? "expireAt" : "*"
    if (
      after?.collection !== "supportRateLimits" ||
      after?.database !== "(default)" ||
      after?.field !== field ||
      after?.index_config?.length !== 1 ||
      after.index_config[0].indexes?.length ||
      (field === "expireAt"
        ? after.ttl_config?.length !== 1
        : after.ttl_config?.length > 0)
    )
      throw new Error("Unexpected support counter retention/index policy")
  }
}

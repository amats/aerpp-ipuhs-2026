import { assertImageCleanupPolicies } from "../../cloud/image-retention-policy.mjs"
import { permitsMaintenanceUpdate } from "../../support/support-update-policy.mjs"

export function assertServicePlanResource(resource, plan, project, region) {
  if (
    [
      "google_artifact_registry_repository.support",
      "google_artifact_registry_repository.admin[0]",
    ].includes(resource.address)
  ) {
    const role = resource.address.endsWith("support") ? "support" : "admin"
    assertImageCleanupPolicies(
      resource.change.after,
      plan.variables?.image_retention_pins?.value?.[role],
    )
  }
  if (
    /^google_[a-z0-9_]+\.admin\[/.test(resource.address) &&
    !["create", "no-op"].includes(resource.change.actions.join()) &&
    !(
      [
        "google_cloud_run_v2_service.admin[0]",
        "google_artifact_registry_repository.admin[0]",
      ].includes(resource.address) && permitsMaintenanceUpdate(resource)
    )
  )
    throw new Error(
      "Admin resources permit creation or reviewed service updates only",
    )
  if (resource.address === "google_cloud_run_v2_service.admin[0]") {
    const admin = plan.variables?.admin?.value
    if (
      !admin ||
      !["create", "no-op", "update"].includes(resource.change.actions.join()) ||
      resource.change.after?.name !== admin.service ||
      resource.change.after?.location !== region ||
      resource.change.after?.template?.[0]?.containers?.[0]?.image !==
        admin.image ||
      (resource.change.after?.traffic?.[0]?.revision ?? null) !==
        (admin.revision ?? null)
    )
      throw new Error("Admin service must match selected deployment")
  }
  if (
    resource.address === "google_monitoring_notification_channel.support[0]"
  ) {
    const value = resource.change.after
    if (
      value?.type !== "email" ||
      value?.enabled !== true ||
      value?.labels?.email_address !==
        plan.variables?.monitoring?.value?.notification_email ||
      Object.keys(value?.labels ?? {}).join() !== "email_address"
    )
      throw new Error("Unexpected monitoring notification destination")
  }
  if (resource.address.startsWith("google_cloud_scheduler_job.support[")) {
    const after = resource.change.after
    const operation = resource.address.endsWith('["mail-health"]')
      ? "mail-health"
      : "withdrawal-cleanup"
    const http = after?.http_target?.[0]
    if (
      after?.name !== `aerpp-support-${operation}` ||
      after?.region !== region ||
      after?.schedule !==
        (operation === "withdrawal-cleanup" ? "*/30 * * * *" : "0 */6 * * *") ||
      after?.time_zone !== "Etc/UTC" ||
      after?.paused !==
        !plan.variables?.deployment?.value?.maintenance_enabled ||
      http?.http_method !== "POST" ||
      !new RegExp(
        `^https://aerpp-support-[0-9]+\\.${region}\\.run\\.app/maintenance/${operation}$`,
      ).test(http?.uri ?? "") ||
      http?.oidc_token?.[0]?.audience !== http?.uri ||
      http?.oidc_token?.[0]?.service_account_email !==
        `aerpp-support-scheduler@${project}.iam.gserviceaccount.com`
    )
      throw new Error("Unexpected support Scheduler target or identity")
  }
  if (resource.address === "google_cloud_run_v2_service.support[0]") {
    const after = resource.change.after
    const deployment = plan.variables?.deployment?.value
    if (
      !deployment ||
      after?.name !== "aerpp-support" ||
      after?.location !== region ||
      after?.template?.[0]?.containers?.[0]?.image !== deployment.image ||
      after?.template?.[0]?.service_account !==
        `aerpp-support-runtime@${project}.iam.gserviceaccount.com`
    )
      throw new Error("Unexpected support service deployment")
  }
}

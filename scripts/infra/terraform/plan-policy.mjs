import { permitsMaintenanceUpdate } from "../../support/support-update-policy.mjs"
import { assertDocumentPlanResource } from "./documents-plan.mjs"
import { assertFirestorePlanResource } from "./firestore-plan.mjs"
import { assertIdentityPlanResource } from "./identity-plan.mjs"
import { assertQuestionnairePlanResource } from "./questionnaire-plan.mjs"
import { assertServicePlanResource } from "./service-plan.mjs"

const FOUNDATION_ADDRESSES = new Set([
  'google_firestore_backup_schedule.daily["default"]',
  ...[
    "roles/datastore.viewer",
    "roles/datastore.user",
    "roles/logging.viewer",
  ].map((key) => `google_project_iam_member.local_admin["${key}"]`),
  "google_service_account_iam_member.local_admin_operator",
  "google_service_account.local_admin",
  "google_service_account.logging",
  "google_project_iam_member.logging",
  "google_cloud_run_v2_service.admin[0]",
  "google_artifact_registry_repository.admin[0]",
  "google_service_account.admin[0]",
  "google_cloud_run_v2_service_iam_member.admin[0]",
  ...[
    "NEXTAUTH_SECRET",
    "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
    "SESSION_SEAL_PASSWORD",
    "IDENTIFIER_HASH_SECRET",
  ].flatMap((key) => [
    `google_secret_manager_secret.admin["${key}"]`,
    `google_secret_manager_secret_iam_member.admin["${key}"]`,
  ]),
  ...[
    "roles/datastore.viewer",
    "roles/datastore.user",
    "roles/logging.viewer",
  ].map((key) => `google_project_iam_member.admin["${key}"]`),
  'google_firestore_database.primary["default"]',
  ...[
    "emailConfirmations",
    "participationEvents",
    "analysisQuestionnaires",
  ].map((key) => `google_firestore_index.existing["${key}"]`),
  ...[
    "emailConfirmations/expireAt",
    "information/expireAt",
    "analysisQuestionnaires/*",
    "analysisQuestionnaires/_integrity",
    "analysisQuestionnaires/pseudonym",
    "analysisAttempts/*",
    "analysisAttempts/pseudonym",
  ].map((key) => `google_firestore_field.existing["${key}"]`),
  "google_monitoring_notification_channel.support[0]",
  "google_monitoring_alert_policy.support_errors[0]",
  "google_artifact_registry_repository.support",
  "google_service_account.support",
  "google_service_account.scheduler",
  "google_secret_manager_secret.runtime",
  "google_secret_manager_secret_iam_member.runtime",
  "google_cloud_run_v2_service.support[0]",
  "google_project_iam_member.support_firestore",
  'google_cloud_scheduler_job.support["withdrawal-cleanup"]',
  'google_cloud_scheduler_job.support["mail-health"]',
  'google_firestore_field.support_rate_limits["*"]',
  'google_firestore_field.support_rate_limits["expireAt"]',
  'google_secret_manager_secret.gmail["SUPPORT_GMAIL_CLIENT_SECRET"]',
  'google_secret_manager_secret.gmail["SUPPORT_GMAIL_REFRESH_TOKEN"]',
])

export function assertFoundationPlan(plan, project, region) {
  if (
    plan.errored ||
    plan.variables?.project_id?.value !== project ||
    plan.variables?.region?.value !== region
  )
    throw new Error("Terraform plan target mismatch")
  for (const resource of plan.resource_changes ?? []) {
    if (
      assertQuestionnairePlanResource(resource, plan, project, region) ===
        true ||
      assertDocumentPlanResource(resource, plan, project, region) === true
    )
      continue
    if (
      resource.address === "data.google_project.selected" &&
      ["read", "no-op"].includes(resource.change.actions.join(",")) &&
      resource.change.after?.project_id === project
    )
      continue
    assertServicePlanResource(resource, plan, project, region)
    assertFirestorePlanResource(resource, plan, project)
    if (assertIdentityPlanResource(resource, plan, project) === true) continue
    if (
      !FOUNDATION_ADDRESSES.has(resource.address) ||
      (!["create", "no-op"].includes(resource.change.actions.join(",")) &&
        permitsMaintenanceUpdate(resource) !== true) ||
      resource.change.after?.project !== project
    )
      throw new Error(
        "Foundation plan must only create or preserve the owned support preparation resources",
      )
  }
}

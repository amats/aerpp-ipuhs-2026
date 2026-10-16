export function assertIdentityPlanResource(resource, plan, project) {
  if (
    resource.address ===
    "google_service_account_iam_member.local_admin_operator"
  ) {
    const after = resource.change.after
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      after?.service_account_id !==
        `projects/${project}/serviceAccounts/${plan.variables?.local_admin_account?.value}` ||
      after?.role !== "roles/iam.serviceAccountTokenCreator" ||
      after?.member !== `user:${plan.variables?.operator_account?.value}`
    )
      throw new Error("Unexpected local Admin impersonation grant")
    return true
  }
  if (
    [
      "google_service_account.local_admin",
      "google_service_account.logging",
    ].includes(resource.address)
  ) {
    const key = resource.address.endsWith("local_admin")
      ? "local_admin_account"
      : "logging_account"
    const email = plan.variables?.[key]?.value
    if (
      !email?.endsWith(`@${project}.iam.gserviceaccount.com`) ||
      resource.change.after?.account_id !== email.split("@")[0]
    )
      throw new Error("Unexpected managed service-account identity")
  }
  if (
    resource.address === "google_project_iam_member.logging" &&
    (resource.change.after?.member !==
      `serviceAccount:${plan.variables?.logging_account?.value}` ||
      resource.change.after?.role !== "roles/logging.logWriter")
  )
    throw new Error("Unexpected logging writer grant")
  if (resource.address.startsWith("google_project_iam_member.admin[")) {
    const account = plan.variables?.admin?.value?.account_id
    const after = resource.change.after
    if (
      !account ||
      after?.member !==
        `serviceAccount:${account}@${project}.iam.gserviceaccount.com` ||
      resource.address !== `google_project_iam_member.admin["${after?.role}"]`
    )
      throw new Error("Unexpected hosted Admin grant")
  }
  if (resource.address.startsWith("google_project_iam_member.local_admin[")) {
    const expected = plan.variables?.local_admin_account?.value
    if (
      !expected?.endsWith(`@${project}.iam.gserviceaccount.com`) ||
      resource.change.after?.member !== `serviceAccount:${expected}` ||
      ![
        "roles/datastore.viewer",
        "roles/datastore.user",
        "roles/logging.viewer",
      ].includes(resource.change.after?.role) ||
      resource.address !==
        `google_project_iam_member.local_admin["${resource.change.after?.role}"]`
    )
      throw new Error("Unexpected local Admin grant")
  }
  if (
    resource.address === "google_project_iam_member.support_firestore" &&
    (resource.change.after?.role !== "roles/datastore.user" ||
      resource.change.after?.member !==
        `serviceAccount:aerpp-support-runtime@${project}.iam.gserviceaccount.com`)
  )
    throw new Error("Unexpected support Firestore grant")
  if (
    resource.address === "google_secret_manager_secret_iam_member.runtime" &&
    (resource.change.after?.role !== "roles/secretmanager.secretAccessor" ||
      resource.change.after?.member !==
        `serviceAccount:aerpp-support-runtime@${project}.iam.gserviceaccount.com` ||
      ![
        "SUPPORT_RUNTIME_JSON",
        `projects/${project}/secrets/SUPPORT_RUNTIME_JSON`,
      ].includes(resource.change.after?.secret_id))
  )
    throw new Error("Unexpected support runtime secret access")
  return false
}

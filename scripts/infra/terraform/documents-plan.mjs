import { documentBucket } from "@aerpp/config/document-set"

export function assertDocumentPlanResource(resource, plan, project, region) {
  if (resource.address === "google_storage_bucket.documents") {
    const after = resource.change.after
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      resource.change.importing ||
      after?.project !== project ||
      after?.name !== documentBucket(project) ||
      after?.location?.toLowerCase() !== region.toLowerCase() ||
      after?.uniform_bucket_level_access !== true ||
      after?.public_access_prevention !== "enforced" ||
      after?.force_destroy !== false ||
      after?.versioning?.[0]?.enabled !== true ||
      (after?.lifecycle_rule?.length ?? 0) !== 0
    )
      throw new Error(
        "Document archive permits private, retained creation or no-op only",
      )
    return true
  }
  const archiveGrants = new Map([
    [
      "google_storage_bucket_iam_member.document_support",
      {
        role: "roles/storage.objectViewer",
        member: `serviceAccount:aerpp-support-runtime@${project}.iam.gserviceaccount.com`,
      },
    ],
    ...["roles/storage.objectCreator", "roles/storage.objectViewer"].map(
      (role) => [
        `google_storage_bucket_iam_member.document_operator["${role}"]`,
        { role, member: `user:${plan.variables?.operator_account?.value}` },
      ],
    ),
    [
      "google_storage_bucket_iam_member.document_local_admin",
      {
        role: "roles/storage.objectViewer",
        member: `serviceAccount:${plan.variables?.local_admin_account?.value}`,
      },
    ],
    [
      "google_storage_bucket_iam_member.document_admin[0]",
      {
        role: "roles/storage.objectViewer",
        member: `serviceAccount:${plan.variables?.admin?.value?.account_id}@${project}.iam.gserviceaccount.com`,
      },
    ],
  ])
  const archiveGrant = archiveGrants.get(resource.address)
  if (archiveGrant !== undefined) {
    const after = resource.change.after
    if (
      !["create", "no-op"].includes(resource.change.actions.join()) ||
      resource.change.importing ||
      ![documentBucket(project), `b/${documentBucket(project)}`].includes(
        after?.bucket,
      ) ||
      after?.role !== archiveGrant.role ||
      after?.member !== archiveGrant.member ||
      (after?.condition?.length ?? 0) !== 0
    )
      throw new Error("Unexpected document archive grant")
    return true
  }
  return false
}

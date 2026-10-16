import { gcloud } from "../shared/delivery.mjs"

export const REQUIRED_CLOUD_APIS = [
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "secretmanager.googleapis.com",
  "firestore.googleapis.com",
  "cloudscheduler.googleapis.com",
  "monitoring.googleapis.com",
  "logging.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "storage.googleapis.com",
  "serviceusage.googleapis.com",
  "gmail.googleapis.com",
]

export function assertProjectReady(projectId, execute = gcloud) {
  const project = JSON.parse(
    execute(projectId, [
      "projects",
      "describe",
      projectId,
      "--format=json(lifecycleState)",
    ]),
  )
  if (project.lifecycleState !== "ACTIVE")
    throw new Error("The selected Google Cloud project must be active")
  const billing = JSON.parse(
    execute(projectId, [
      "billing",
      "projects",
      "describe",
      projectId,
      "--format=json(billingEnabled)",
    ]),
  )
  if (billing.billingEnabled !== true)
    throw new Error(
      "Enable billing for the selected project before cloud setup",
    )
}

export function enableProjectServices(projectId, execute = gcloud) {
  execute(projectId, ["services", "enable", ...REQUIRED_CLOUD_APIS])
}

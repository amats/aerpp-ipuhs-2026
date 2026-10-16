# Application/deployment consumers read this versioned, non-secret contract.
# Resource names remain owned here rather than copied into manual profiles.
output "support_foundation" {
  description = "Non-secret support identities projected into private auto.json."
  value = {
    version                 = 1
    project                 = var.project_id
    region                  = var.region
    repository              = google_artifact_registry_repository.support.id
    runtimeServiceAccount   = google_service_account.support.email
    schedulerServiceAccount = google_service_account.scheduler.email
    # Deterministic Cloud Run endpoint, available before first deployment.
    # This output does not assert that the service exists or is reachable.
    serviceEndpoint = {
      name          = "aerpp-support"
      projectNumber = data.google_project.selected.number
      baseUrl       = "https://aerpp-support-${data.google_project.selected.number}.${var.region}.run.app"
    }
    gmailSecretIds = {
      clientSecret = google_secret_manager_secret.gmail["SUPPORT_GMAIL_CLIENT_SECRET"].secret_id
      refreshToken = google_secret_manager_secret.gmail["SUPPORT_GMAIL_REFRESH_TOKEN"].secret_id
    }
  }
}

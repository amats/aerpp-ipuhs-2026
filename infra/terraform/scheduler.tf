resource "google_cloud_scheduler_job" "support" {
  for_each = var.deployment == null ? {} : {
    withdrawal-cleanup = "*/30 * * * *"
    mail-health        = "0 */6 * * *"
  }
  project          = var.project_id
  region           = var.region
  name             = "aerpp-support-${each.key}"
  schedule         = each.value
  time_zone        = "Etc/UTC"
  paused           = !var.deployment.maintenance_enabled
  attempt_deadline = "75s"
  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }
  http_target {
    http_method = "POST"
    uri         = "https://aerpp-support-${data.google_project.selected.number}.${var.region}.run.app/maintenance/${each.key}"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = "https://aerpp-support-${data.google_project.selected.number}.${var.region}.run.app/maintenance/${each.key}"
    }
  }
  depends_on = [google_cloud_run_v2_service.support]
  lifecycle { prevent_destroy = true }
}

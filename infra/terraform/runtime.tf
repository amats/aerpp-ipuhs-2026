# Deployment snapshots contain only an immutable image and numeric secret version.
variable "deployment" {
  type    = object({ image = string, runtime_version = string, maintenance_enabled = optional(bool, false) })
  default = null
  validation {
    condition = var.deployment == null ? true : (
      can(regex("@sha256:[a-f0-9]{64}$", var.deployment.image)) &&
      can(regex("^[1-9][0-9]*$", var.deployment.runtime_version))
    )
    error_message = "Use an immutable image digest and numeric secret version."
  }
}

resource "google_secret_manager_secret" "runtime" {
  secret_id = "SUPPORT_RUNTIME_JSON"
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.support.email}"
}

# Participant admission and maintenance remain closed during data-plane checks.
resource "google_cloud_run_v2_service" "support" {
  count                = var.deployment == null ? 0 : 1
  name                 = "aerpp-support"
  location             = var.region
  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  labels               = { aerpp-component = "support", aerpp-environment = var.environment }
  template {
    labels                           = { aerpp-component = "support", aerpp-environment = var.environment }
    service_account                  = google_service_account.support.email
    timeout                          = "60s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.deployment.image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name = "SUPPORT_RUNTIME_JSON"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.runtime.secret_id
            version = var.deployment.runtime_version
          }
        }
      }
      startup_probe {
        period_seconds    = 1
        timeout_seconds   = 1
        failure_threshold = 30
        http_get { path = "/health" }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.runtime]
  lifecycle { prevent_destroy = true }
}

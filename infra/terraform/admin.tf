variable "admin" {
  type = object({
    service       = string
    repository    = string
    account_id    = string
    max_instances = number
    image         = optional(string)
    revision      = optional(string)
    runtime       = optional(map(string), {})
    secret_refs   = map(object({ secret = string, version = optional(string) }))
  })
  default     = null
  description = "Accepted Admin deployment metadata and projected non-secret runtime; never secret values."
}
provider "google" {
  alias                           = "imported"
  project                         = var.project_id
  region                          = var.region
  add_terraform_attribution_label = false
}
resource "google_cloud_run_v2_service" "admin" {
  count               = var.admin == null ? 0 : (var.admin.image == null ? 0 : 1)
  provider            = google.imported
  project             = var.project_id
  name                = var.admin.service
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  launch_stage        = "GA"
  deletion_protection = true
  depends_on          = [google_secret_manager_secret_iam_member.admin, google_project_iam_member.admin, google_storage_bucket_iam_member.questionnaire_admin]
  scaling { max_instance_count = 20 }
  template {
    labels                           = { aerpp-component = "admin", aerpp-environment = var.environment }
    service_account                  = google_service_account.admin[0].email
    timeout                          = "120s"
    max_instance_request_concurrency = 20
    scaling { max_instance_count = var.admin.max_instances }
    containers {
      image = var.admin.image
      ports {
        name           = "http1"
        container_port = 8080
      }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        timeout_seconds   = 240
        period_seconds    = 240
        failure_threshold = 1
        tcp_socket { port = 8080 }
      }
      dynamic "env" {
        for_each = [for key in ["AERPP_ENVIRONMENT", "GCP_PROJECT_ID", "PARTICIPANT_API_SERVER_ID", "SUPPORT_RECEPTION_EXPIRES_AT", "SUPPORT_BACKEND_STOPS_AT", "ADMIN_ALLOWED_EMAILS", "ADMIN_GOOGLE_OAUTH_CLIENT_ID", "NEXTAUTH_URL"] : { name = key, value = var.admin.runtime[key] }]
        content {
          name  = env.value.name
          value = env.value.value
        }
      }
      dynamic "env" {
        # Create the new container/IAM before preparation supplies its first version.
        # Existing images retain their secret bindings during that foundation step.
        for_each = [for key in ["NEXTAUTH_SECRET", "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET", "SESSION_SEAL_PASSWORD", "IDENTIFIER_HASH_SECRET"] : { name = key, ref = var.admin.secret_refs[key] } if !contains(["SESSION_SEAL_PASSWORD", "IDENTIFIER_HASH_SECRET"], key) || var.admin.secret_refs[key].version != null]
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.ref.secret
              version = env.value.ref.version
            }
          }
        }
      }
    }
  }
  traffic {
    type     = var.admin.revision == null ? "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" : "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION"
    revision = var.admin.revision
    percent  = 100
  }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [client, client_version]
  }
}

resource "google_artifact_registry_repository" "admin" {
  count         = var.admin == null ? 0 : 1
  provider      = google.imported
  project       = var.project_id
  location      = var.region
  repository_id = var.admin.repository
  format        = "DOCKER"
  mode          = "STANDARD_REPOSITORY"
  docker_config { immutable_tags = false }
  cleanup_policy_dry_run = false
  dynamic "cleanup_policies" {
    for_each = local.image_cleanup_policies
    content {
      id     = cleanup_policies.value.id
      action = cleanup_policies.value.action
      dynamic "condition" {
        for_each = cleanup_policies.value.condition == null ? [] : [cleanup_policies.value.condition]
        content {
          tag_state  = condition.value.tag_state
          older_than = condition.value.older_than
        }
      }
      dynamic "most_recent_versions" {
        for_each = cleanup_policies.value.most_recent_versions == null ? [] : [cleanup_policies.value.most_recent_versions]
        content { keep_count = most_recent_versions.value.keep_count }
      }
    }
  }
  dynamic "cleanup_policies" {
    for_each = length(var.image_retention_pins.admin) == 0 ? [] : [var.image_retention_pins.admin]
    content {
      id     = "keep-deployed"
      action = "KEEP"
      condition {
        tag_state             = "ANY"
        version_name_prefixes = [for digest in cleanup_policies.value : substr(digest, 0, 64)]
      }
    }
  }
  lifecycle { prevent_destroy = true }
}
resource "google_service_account" "admin" {
  count        = var.admin == null ? 0 : 1
  provider     = google.imported
  project      = var.project_id
  account_id   = var.admin.account_id
  display_name = "AERPP Admin runtime"
  lifecycle { prevent_destroy = true }
}
resource "google_secret_manager_secret" "admin" {
  for_each  = var.admin == null ? {} : var.admin.secret_refs
  provider  = google.imported
  project   = var.project_id
  secret_id = each.value.secret
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}
resource "google_secret_manager_secret_iam_member" "admin" {
  for_each  = var.admin == null ? {} : var.admin.secret_refs
  provider  = google.imported
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin[0].email}"
  lifecycle { prevent_destroy = true }
}
resource "google_project_iam_member" "admin" {
  for_each = var.admin == null ? toset([]) : toset(["roles/datastore.viewer", "roles/datastore.user", "roles/logging.viewer"])
  provider = google.imported
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.admin[0].email}"
  lifecycle { prevent_destroy = true }
}
resource "google_cloud_run_v2_service_iam_member" "admin" {
  count    = var.admin == null ? 0 : (var.admin.image == null ? 0 : 1)
  provider = google.imported
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
  lifecycle { prevent_destroy = true }
}

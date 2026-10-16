variable "environment" {
  type = string
  validation {
    condition     = contains(["test", "production"], var.environment)
    error_message = "Select test or production."
  }
}

variable "project_id" {
  type        = string
  description = "Selected project from the private profile projectId."
}

variable "region" {
  type        = string
  description = "Selected private profile infrastructure region."
}

data "google_project" "selected" {
  project_id = var.project_id
}

resource "google_artifact_registry_repository" "support" {
  location               = var.region
  repository_id          = "aerpp-support"
  format                 = "DOCKER"
  description            = "Private support application images"
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
    for_each = length(var.image_retention_pins.support) == 0 ? [] : [var.image_retention_pins.support]
    content {
      id     = "keep-deployed"
      action = "KEEP"
      condition {
        tag_state             = "ANY"
        version_name_prefixes = [for digest in cleanup_policies.value : substr(digest, 0, 64)]
      }
    }
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "support" {
  account_id   = "aerpp-support-runtime"
  display_name = "Support application runtime"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "scheduler" {
  account_id   = "aerpp-support-scheduler"
  display_name = "Support maintenance OIDC caller"
  lifecycle {
    prevent_destroy = true
  }
}

# Containers only: OAuth/token values are never Terraform inputs or state.
resource "google_secret_manager_secret" "gmail" {
  for_each  = toset(["SUPPORT_GMAIL_CLIENT_SECRET", "SUPPORT_GMAIL_REFRESH_TOKEN"])
  secret_id = each.value
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
  }
}

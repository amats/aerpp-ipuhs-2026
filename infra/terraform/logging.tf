variable "logging_account" {
  type        = string
  description = "Logging credential identity or the new environment's managed account; no key material."
}

resource "google_service_account" "logging" {
  project      = var.project_id
  account_id   = split("@", var.logging_account)[0]
  display_name = "AERPP operational logging"
  lifecycle { prevent_destroy = true }
}

resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.logging.email}"
  lifecycle { prevent_destroy = true }
}

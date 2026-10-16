variable "local_admin_account" {
  type        = string
  description = "Keyless local Admin identity with information write access."
}

resource "google_project_iam_member" "local_admin" {
  for_each   = toset(["roles/datastore.viewer", "roles/datastore.user", "roles/logging.viewer"])
  project    = var.project_id
  role       = each.key
  member     = "serviceAccount:${var.local_admin_account}"
  depends_on = [google_service_account.local_admin]
}

resource "google_service_account" "local_admin" {
  project      = var.project_id
  account_id   = split("@", var.local_admin_account)[0]
  display_name = "AERPP local Admin reader"
  lifecycle { prevent_destroy = true }
}

variable "operator_account" {
  type        = string
  description = "Selected operator account, granted impersonation of the local Admin identity only."
}

resource "google_service_account_iam_member" "local_admin_operator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.local_admin_account}"
  depends_on         = [google_service_account.local_admin]
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.operator_account}"
}

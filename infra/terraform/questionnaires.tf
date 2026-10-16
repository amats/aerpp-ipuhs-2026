# One archive per selected project; questionnaire identity is environment independent.
resource "google_storage_bucket" "questionnaires" {
  project                     = var.project_id
  name                        = "${var.project_id}-questionnaires"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
}

resource "google_storage_bucket_iam_member" "questionnaire_operator" {
  for_each = toset(["roles/storage.objectCreator", "roles/storage.objectViewer"])
  bucket   = google_storage_bucket.questionnaires.name
  role     = each.value
  member   = "user:${var.operator_account}"
}

resource "google_storage_bucket_iam_member" "questionnaire_local_admin" {
  bucket = google_storage_bucket.questionnaires.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.local_admin.email}"
}

resource "google_storage_bucket_iam_member" "questionnaire_admin" {
  count  = var.admin == null ? 0 : 1
  bucket = google_storage_bucket.questionnaires.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.admin[0].email}"
}

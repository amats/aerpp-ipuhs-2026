# Blank research originals only. Filled participant PDFs are never archived here.
resource "google_storage_bucket" "documents" {
  project                     = var.project_id
  name                        = "${var.project_id}-documents"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
}
resource "google_storage_bucket_iam_member" "document_operator" {
  for_each = toset(["roles/storage.objectCreator", "roles/storage.objectViewer"])
  bucket   = google_storage_bucket.documents.name
  role     = each.value
  member   = "user:${var.operator_account}"
}
resource "google_storage_bucket_iam_member" "document_support" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.support.email}"
}
resource "google_storage_bucket_iam_member" "document_local_admin" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.local_admin.email}"
}
resource "google_storage_bucket_iam_member" "document_admin" {
  count  = var.admin == null ? 0 : 1
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.admin[0].email}"
}

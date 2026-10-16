resource "google_firestore_field" "support_rate_limits" {
  for_each   = toset(["*", "expireAt"])
  project    = var.project_id
  database   = "(default)"
  depends_on = [google_firestore_database.primary]
  collection = "supportRateLimits"
  field      = each.value
  index_config {}
  dynamic "ttl_config" {
    for_each = each.value == "expireAt" ? [true] : []
    content {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_project_iam_member" "support_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.support.email}"
}

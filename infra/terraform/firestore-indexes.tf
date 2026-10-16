locals {
  manage_existing_indexes = var.firestore != null && try(var.firestore.manage_existing_indexes, false)
  composite_indexes = {
    emailConfirmations     = ["serverId", "clientId", "pseudonym", "status", "__name__"]
    participationEvents    = ["pseudonym", "eventType", "__name__"]
    analysisQuestionnaires = ["pseudonym", "submittedAt", "__name__"]
  }
  existing_fields = {
    "emailConfirmations/expireAt"       = { collection = "emailConfirmations", field = "expireAt", ttl = true, orders = ["ASCENDING", "DESCENDING", "CONTAINS"] }
    "information/expireAt"              = { collection = "information", field = "expireAt", ttl = true, orders = ["ASCENDING", "DESCENDING", "CONTAINS"] }
    "analysisQuestionnaires/*"          = { collection = "analysisQuestionnaires", field = "*", ttl = false, orders = [] }
    "analysisQuestionnaires/_integrity" = { collection = "analysisQuestionnaires", field = "_integrity", ttl = false, orders = [] }
    "analysisQuestionnaires/pseudonym"  = { collection = "analysisQuestionnaires", field = "pseudonym", ttl = false, orders = ["ASCENDING"] }
    "analysisAttempts/*"                = { collection = "analysisAttempts", field = "*", ttl = false, orders = [] }
    "analysisAttempts/pseudonym"        = { collection = "analysisAttempts", field = "pseudonym", ttl = false, orders = ["ASCENDING"] }
  }
}

resource "google_firestore_index" "existing" {
  for_each        = local.manage_existing_indexes ? local.composite_indexes : {}
  project         = var.project_id
  database        = "(default)"
  depends_on      = [google_firestore_database.primary]
  collection      = each.key
  query_scope     = "COLLECTION"
  api_scope       = "ANY_API"
  density         = "SPARSE_ALL"
  deletion_policy = "DELETE"
  dynamic "fields" {
    for_each = each.value
    content {
      field_path = fields.value
      order      = "ASCENDING"
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_firestore_field" "existing" {
  for_each   = local.manage_existing_indexes ? local.existing_fields : {}
  project    = var.project_id
  database   = "(default)"
  depends_on = [google_firestore_database.primary]
  collection = each.value.collection
  field      = each.value.field
  index_config {
    dynamic "indexes" {
      for_each = each.value.orders
      content {
        query_scope  = "COLLECTION"
        order        = indexes.value == "CONTAINS" ? null : indexes.value
        array_config = indexes.value == "CONTAINS" ? "CONTAINS" : null
      }
    }
  }
  dynamic "ttl_config" {
    for_each = each.value.ttl ? [true] : []
    content {}
  }
  lifecycle { prevent_destroy = true }
}

variable "firestore" {
  type = object({ location = string, manage_existing_indexes = optional(bool, false), automatic_backups = optional(bool, false), backup_retention_days = optional(number) })
  validation {
    condition     = var.firestore == null ? true : (var.firestore.automatic_backups ? try(var.firestore.backup_retention_days >= 1 && var.firestore.backup_retention_days <= 98 && floor(var.firestore.backup_retention_days) == var.firestore.backup_retention_days, false) : var.firestore.backup_retention_days == null)
    error_message = "Daily backups require an explicit integer retention of 1-98 days; disabled backups must omit retention."
  }
  default     = null
  description = "Existing database identity; its immutable location is explicit in config.json."
}

resource "google_firestore_database" "primary" {
  for_each                          = var.firestore == null ? {} : { default = var.firestore }
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = each.value.location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  database_edition                  = "STANDARD"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = "ABANDON"
  lifecycle { prevent_destroy = true }
}

resource "google_firestore_backup_schedule" "daily" {
  for_each        = var.firestore == null ? {} : (var.firestore.automatic_backups ? { default = var.firestore } : {})
  project         = var.project_id
  database        = google_firestore_database.primary[each.key].name
  retention       = "${each.value.backup_retention_days * 86400}s"
  deletion_policy = "PREVENT"
  daily_recurrence {}
  lifecycle { prevent_destroy = true }
}

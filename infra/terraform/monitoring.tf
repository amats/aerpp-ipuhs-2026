variable "monitoring" {
  type        = object({ notification_email = string })
  default     = null
  description = "Private non-secret notification destination from config.json infrastructure.monitoring."
}

resource "google_monitoring_notification_channel" "support" {
  count        = var.monitoring == null ? 0 : 1
  project      = var.project_id
  display_name = "AERPP support operator"
  type         = "email"
  enabled      = true
  labels       = { email_address = var.monitoring.notification_email }
  lifecycle { prevent_destroy = true }
}

resource "google_monitoring_alert_policy" "support_errors" {
  count                 = var.monitoring == null ? 0 : 1
  project               = var.project_id
  display_name          = "AERPP support errors and maintenance failures"
  combiner              = "OR"
  enabled               = true
  notification_channels = [google_monitoring_notification_channel.support[0].name]
  conditions {
    display_name = "Support or Scheduler failure"
    condition_matched_log {
      filter = templatefile("${path.module}/support-error-filter.tftpl", { project_id = var.project_id })
    }
  }
  alert_strategy {
    notification_rate_limit { period = "3600s" }
    auto_close = "1800s"
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Inspect support and Scheduler aggregate logs. For MAIL_REAUTHORIZATION_REQUIRED follow docs/deployment.md#gmail-reauthorization. Never include credentials, email links, documents or results in incident notes."
  }
  lifecycle { prevent_destroy = true }
}

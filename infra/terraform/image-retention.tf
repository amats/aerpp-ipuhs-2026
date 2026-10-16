variable "image_retention_pins" {
  type        = object({ support = list(string), admin = list(string) })
  description = "Generated from live serving/ready revisions and prepared digests by the selected deployment wrapper."
  validation {
    condition     = alltrue([for digest in concat(var.image_retention_pins.support, var.image_retention_pins.admin) : can(regex("^sha256:[a-f0-9]{64}$", digest))])
    error_message = "Retention pins must be immutable image digests."
  }
}

locals {
  image_cleanup_policies = {
    delete_old  = { id = "delete-old", action = "DELETE", condition = { tag_state = "ANY", older_than = "86400s" }, most_recent_versions = null }
    keep_recent = { id = "keep-recent", action = "KEEP", condition = null, most_recent_versions = { keep_count = 1 } }
  }
}

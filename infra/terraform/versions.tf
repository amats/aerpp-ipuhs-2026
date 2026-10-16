terraform {
  required_version = "= 1.16.3"
  backend "gcs" {}
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

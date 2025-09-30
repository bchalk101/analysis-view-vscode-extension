# Configure the Google Cloud Provider
terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    prefix = "terraform/state"
  }
}

# Configure the Google Cloud Provider
provider "google" {
  project = var.project_id
  region  = var.region
}

# Variables
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "query_engine_service_name" {
  description = "The name of the Query Engine Cloud Run service"
  type        = string
  default     = "query-engine-service"
}

variable "mcp_service_name" {
  description = "The name of the MCP Server Cloud Run service"
  type        = string
  default     = "analysis-mcp-server"
}

variable "image_tag" {
  description = "The Docker image tag to deploy (typically git SHA)"
  type        = string
  default     = "latest"
}

variable "gcs_bucket_name" {
  description = "The name of the GCS bucket for datasets"
  type        = string
  default     = "agentic_analytics_datasets"
}

variable "db_password" {
  description = "Password for the PostgreSQL database"
  type        = string
  sensitive   = true
}


# Enable required APIs
resource "google_project_service" "cloud_run_api" {
  service = "run.googleapis.com"
  project = var.project_id

  disable_dependent_services = true
}

resource "google_project_service" "container_registry_api" {
  service = "containerregistry.googleapis.com"
  project = var.project_id

  disable_dependent_services = true
}

resource "google_project_service" "sql_admin_api" {
  service = "sqladmin.googleapis.com"
  project = var.project_id

  disable_dependent_services = true
}

resource "google_project_service" "secret_manager_api" {
  service = "secretmanager.googleapis.com"
  project = var.project_id

  disable_dependent_services = true
}


# GCS Bucket for datasets
resource "google_storage_bucket" "datasets_bucket" {
  name     = var.gcs_bucket_name
  location = var.region

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.cloud_run_api]
}


# Cloud SQL PostgreSQL instance (minimal cost configuration)
resource "google_sql_database_instance" "analysis_db" {
  name             = "analysis-db-instance"
  database_version = "POSTGRES_15"
  region          = var.region

  settings {
    tier = "db-f1-micro"

    disk_size = 10
    disk_type = "PD_HDD"
    disk_autoresize = false

    backup_configuration {
      enabled = false
    }

    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        value = "0.0.0.0/0"
      }
    }
  }

  deletion_protection = false

  depends_on = [google_project_service.sql_admin_api]
}

resource "google_sql_database" "analysis_catalog" {
  name     = "analysis_catalog"
  instance = google_sql_database_instance.analysis_db.name
}

resource "google_sql_user" "analysis_user" {
  name     = "analysis_user"
  instance = google_sql_database_instance.analysis_db.name
  password = var.db_password
}

resource "google_secret_manager_secret" "query_engine_database_url" {
  secret_id = "query-engine-database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager_api]
}

resource "google_secret_manager_secret_version" "query_engine_database_url" {
  secret      = google_secret_manager_secret.query_engine_database_url.id
  secret_data = "postgresql://analysis_user:${var.db_password}@${google_sql_database_instance.analysis_db.public_ip_address}:5432/analysis_catalog"
}




# Create a custom service account for Cloud Run
resource "google_service_account" "cloud_run_service_account" {
  account_id   = "query-engine-service-sa"
  display_name = "Query Engine Service Account"
  description  = "Service account for the Query Engine Cloud Run service"
}

resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_service_account.email}"

  depends_on = [google_project_service.secret_manager_api]
}

resource "google_project_iam_member" "cloud_run_storage_accessor" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
}

# Get project information
data "google_project" "project" {
  project_id = var.project_id
}

# Query Engine Cloud Run service
resource "google_cloud_run_service" "query_engine_service" {
  name     = var.query_engine_service_name
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/${var.query_engine_service_name}:${var.image_tag}"

        ports {
          container_port = 50051
          name           = "h2c"
        }

        env {
          name  = "GRPC_PORT"
          value = "50051"
        }

        env {
          name  = "GCS_BUCKET_NAME"
          value = var.gcs_bucket_name
        }

        env {
          name  = "DATABASE_URL"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.query_engine_database_url.secret_id
              key  = "latest"
            }
          }
        }

        env {
          name  = "RUST_LOG"
          value = "query_engine_service=info"
        }

        resources {
          limits = {
            cpu    = "4000m"
            memory = "8Gi"
          }
        }
      }

      container_concurrency = 50
      timeout_seconds       = 600
      service_account_name  = google_service_account.cloud_run_service_account.email
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale"           = "5"
        "autoscaling.knative.dev/minScale"           = "1"
        "run.googleapis.com/cpu-throttling"          = "false"
        "run.googleapis.com/execution-environment"   = "gen2"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_service.cloud_run_api,
    google_secret_manager_secret_version.query_engine_database_url
  ]
}

# MCP Server Cloud Run service (publicly accessible)
resource "google_cloud_run_service" "mcp_server_service" {
  name     = var.mcp_service_name
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/${var.mcp_service_name}:${var.image_tag}"

        ports {
          container_port = 8080
          name           = "http1"
        }

        env {
          name  = "MCP_PORT"
          value = "8080"
        }

        env {
          name  = "QUERY_ENGINE_ENDPOINT"
          value = google_cloud_run_service.query_engine_service.status[0].url
        }

        env {
          name  = "RUST_LOG"
          value = "mcp_server=info"
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }

      container_concurrency = 10
      timeout_seconds       = 300
      service_account_name  = google_service_account.cloud_run_service_account.email
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale"           = "10"
        "autoscaling.knative.dev/minScale"           = "0"
        "run.googleapis.com/cpu-throttling"          = "true"
        "run.googleapis.com/execution-environment"   = "gen2"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_service.cloud_run_api,
    google_cloud_run_service.query_engine_service
  ]
}

# IAM policy to make MCP server publicly accessible
resource "google_cloud_run_service_iam_member" "mcp_server_public" {
  location = google_cloud_run_service.mcp_server_service.location
  project  = google_cloud_run_service.mcp_server_service.project
  service  = google_cloud_run_service.mcp_server_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Make query engine private (only accessible by MCP server)
resource "google_cloud_run_service_iam_member" "query_engine_private" {
  location = google_cloud_run_service.query_engine_service.location
  project  = google_cloud_run_service.query_engine_service.project
  service  = google_cloud_run_service.query_engine_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
}


# Outputs

output "query_engine_service_url" {
  description = "The URL of the deployed Query Engine service (private)"
  value       = google_cloud_run_service.query_engine_service.status[0].url
}

output "mcp_server_service_url" {
  description = "The URL of the deployed MCP Server service (public)"
  value       = google_cloud_run_service.mcp_server_service.status[0].url
}

output "database_host" {
  description = "The public IP address of the Cloud SQL instance"
  value       = google_sql_database_instance.analysis_db.public_ip_address
}

output "gcs_bucket_url" {
  description = "The URL of the GCS bucket for datasets"
  value       = google_storage_bucket.datasets_bucket.url
}

output "project_id" {
  description = "The GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "The GCP region"
  value       = var.region
}
#!/bin/bash

# Bootstrap script for Terraform state management and resource imports
# Usage: ./bootstrap-terraform.sh [project-id] [region] [bucket-name] [db-password]

set -e

PROJECT_ID=${1:-$TF_VAR_project_id}
REGION=${2:-$TF_VAR_region}
GCS_BUCKET_NAME=${3:-$TF_VAR_gcs_bucket_name}
DB_PASSWORD=${4:-$TF_VAR_db_password}

if [ -z "$PROJECT_ID" ] || [ -z "$REGION" ] || [ -z "$GCS_BUCKET_NAME" ] || [ -z "$DB_PASSWORD" ]; then
    echo "❌ Missing required parameters"
    echo "Usage: ./bootstrap-terraform.sh [project-id] [region] [bucket-name] [db-password]"
    echo "Or set environment variables: TF_VAR_project_id, TF_VAR_region, TF_VAR_gcs_bucket_name, TF_VAR_db_password"
    exit 1
fi

TERRAFORM_STATE_BUCKET="terraform-state-bucket-analysis-view-${PROJECT_ID}"

echo "🚀 Bootstrapping Terraform for project: ${PROJECT_ID}"
echo "State bucket: ${TERRAFORM_STATE_BUCKET}"

# Determine the terraform directory based on where script is called from
if [ -f "main.tf" ]; then
    # Already in terraform directory
    TERRAFORM_DIR="."
else
    # Called from scripts directory or elsewhere
    TERRAFORM_DIR="$(dirname "$0")/../terraform"
    cd "$TERRAFORM_DIR"
fi

# Check if state bucket exists
if gsutil ls -b gs://${TERRAFORM_STATE_BUCKET} 2>/dev/null; then
    echo "✅ Terraform state bucket already exists"
else
    echo "📦 Creating Terraform state bucket..."
    gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${TERRAFORM_STATE_BUCKET}
    gsutil versioning set on gs://${TERRAFORM_STATE_BUCKET}
fi

# Initialize Terraform with the state bucket
echo "🔧 Initializing Terraform..."
terraform init -backend-config="bucket=${TERRAFORM_STATE_BUCKET}"

# Check if resources exist and need importing
echo "🔍 Checking for existing resources to import..."

RESOURCES_TO_IMPORT=""

# Check for existing bucket
if gsutil ls -b gs://${GCS_BUCKET_NAME} 2>/dev/null; then
    echo "📦 Found existing GCS bucket: ${GCS_BUCKET_NAME}"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_storage_bucket.datasets_bucket:${GCS_BUCKET_NAME}"
fi

# Check for existing Cloud SQL instance
if gcloud sql instances describe analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "🗄️ Found existing Cloud SQL instance: analysis-db-instance"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_sql_database_instance.analysis_db:${PROJECT_ID}:analysis-db-instance"
fi

# Check for existing secret
if gcloud secrets describe query-engine-database-url --project=${PROJECT_ID} 2>/dev/null; then
    echo "🔐 Found existing secret: query-engine-database-url"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_secret_manager_secret.query_engine_database_url:projects/${PROJECT_ID}/secrets/query-engine-database-url"
fi

# Import existing resources
if [ -n "$RESOURCES_TO_IMPORT" ]; then
    echo "📥 Importing existing resources..."
    for resource in $RESOURCES_TO_IMPORT; do
        IFS=':' read -r terraform_resource gcp_resource <<< "$resource"
        echo "Importing: $terraform_resource -> $gcp_resource"
        terraform import $terraform_resource $gcp_resource || echo "⚠️ Failed to import $terraform_resource (might already be imported)"
    done
else
    echo "✅ No existing resources found to import"
fi

# Run terraform plan to verify everything is configured correctly
echo "📋 Running terraform plan..."
terraform plan

echo "✅ Terraform bootstrap completed successfully!"
echo ""
echo "🔗 State bucket: gs://${TERRAFORM_STATE_BUCKET}"
echo "📁 State file: gs://${TERRAFORM_STATE_BUCKET}/terraform/state/default.tfstate"
echo ""
echo "🚀 You can now run 'terraform apply' safely"
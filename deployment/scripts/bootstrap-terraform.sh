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
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_sql_database_instance.analysis_db:analysis-db-instance"
fi

# Check for existing secret
if gcloud secrets describe query-engine-database-url --project=${PROJECT_ID} 2>/dev/null; then
    echo "🔐 Found existing secret: query-engine-database-url"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_secret_manager_secret.query_engine_database_url:projects/${PROJECT_ID}/secrets/query-engine-database-url"
fi

# Check for existing database within the SQL instance
if gcloud sql databases describe analysis_catalog --instance=analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "🗃️ Found existing database: analysis_catalog"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_sql_database.analysis_catalog:${PROJECT_ID}/analysis-db-instance/analysis_catalog"
fi

# Check for existing database user
if gcloud sql users describe analysis_user --instance=analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "👤 Found existing database user: analysis_user"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_sql_user.analysis_user:analysis_user/analysis-db-instance/${PROJECT_ID}"
fi

# Check for existing Cloud Run services
if gcloud run services describe query-engine-service --region=${REGION} --project=${PROJECT_ID} 2>/dev/null; then
    echo "🚀 Found existing Cloud Run service: query-engine-service"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_cloud_run_service.query_engine_service:locations/${REGION}/namespaces/${PROJECT_ID}/services/query-engine-service"
fi

if gcloud run services describe analysis-mcp-server --region=${REGION} --project=${PROJECT_ID} 2>/dev/null; then
    echo "🚀 Found existing Cloud Run service: analysis-mcp-server"
    RESOURCES_TO_IMPORT="${RESOURCES_TO_IMPORT} google_cloud_run_service.mcp_server_service:locations/${REGION}/namespaces/${PROJECT_ID}/services/analysis-mcp-server"
fi

# Import existing resources
if [ -n "$RESOURCES_TO_IMPORT" ]; then
    echo "📥 Importing existing resources..."
    IMPORT_FAILED=0
    for resource in $RESOURCES_TO_IMPORT; do
        IFS=':' read -r terraform_resource gcp_resource <<< "$resource"
        echo "Importing: $terraform_resource -> $gcp_resource"

        # Check if resource is already in state
        if terraform state show $terraform_resource 2>/dev/null; then
            echo "✅ Resource $terraform_resource already in state, skipping import"
            continue
        fi

        # Attempt import
        if terraform import $terraform_resource "$gcp_resource"; then
            echo "✅ Successfully imported $terraform_resource"
        else
            echo "❌ Failed to import $terraform_resource"
            IMPORT_FAILED=1
        fi
    done

    if [ $IMPORT_FAILED -eq 1 ]; then
        echo "⚠️ Some resources failed to import. You may need to import them manually or delete them if they're not needed."
        echo "Manual import commands:"
        for resource in $RESOURCES_TO_IMPORT; do
            IFS=':' read -r terraform_resource gcp_resource <<< "$resource"
            echo "  terraform import $terraform_resource \"$gcp_resource\""
        done
    fi
else
    echo "✅ No existing resources found to import"
fi

# Run terraform plan to verify everything is configured correctly
echo "📋 Running terraform plan..."
PLAN_OUTPUT=$(terraform plan -no-color 2>&1)
echo "$PLAN_OUTPUT"

# Check if plan shows any creates for resources that should have been imported
if echo "$PLAN_OUTPUT" | grep -q "# google_sql_database_instance.analysis_db will be created"; then
    echo "❌ ERROR: Terraform plan still shows Cloud SQL instance will be created!"
    echo "This means the import failed. The instance likely already exists."
    echo "Try running: terraform import google_sql_database_instance.analysis_db analysis-db-instance"
    exit 1
fi

if echo "$PLAN_OUTPUT" | grep -q "# google_storage_bucket.datasets_bucket will be created"; then
    echo "❌ ERROR: Terraform plan still shows GCS bucket will be created!"
    echo "This means the import failed. The bucket likely already exists."
    echo "Try running: terraform import google_storage_bucket.datasets_bucket ${GCS_BUCKET_NAME}"
    exit 1
fi

if echo "$PLAN_OUTPUT" | grep -q "# google_secret_manager_secret.query_engine_database_url will be created"; then
    echo "❌ ERROR: Terraform plan still shows secret will be created!"
    echo "This means the import failed. The secret likely already exists."
    echo "Try running: terraform import google_secret_manager_secret.query_engine_database_url projects/${PROJECT_ID}/secrets/query-engine-database-url"
    exit 1
fi

if echo "$PLAN_OUTPUT" | grep -q "will be created" && [ -n "$RESOURCES_TO_IMPORT" ]; then
    echo "⚠️ WARNING: Some resources will still be created despite import attempts."
    echo "Please review the plan above and manually import any missing resources."
fi

echo "✅ Terraform bootstrap completed successfully!"
echo ""
echo "🔗 State bucket: gs://${TERRAFORM_STATE_BUCKET}"
echo "📁 State file: gs://${TERRAFORM_STATE_BUCKET}/terraform/state/default.tfstate"
echo ""
echo "🚀 You can now run 'terraform apply' safely"
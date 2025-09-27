#!/bin/bash

set -e

PROJECT_ID=${1:-$TF_VAR_project_id}
REGION=${2:-$TF_VAR_region}
GCS_BUCKET_NAME=${3:-$TF_VAR_gcs_bucket_name}

if [ -z "$PROJECT_ID" ] || [ -z "$REGION" ] || [ -z "$GCS_BUCKET_NAME" ]; then
    echo "❌ Missing required parameters"
    echo "Usage: ./fix-terraform-imports.sh [project-id] [region] [bucket-name]"
    echo "Or set environment variables: TF_VAR_project_id, TF_VAR_region, TF_VAR_gcs_bucket_name"
    exit 1
fi

echo "🔧 Fixing Terraform imports for project: ${PROJECT_ID}"

cd "$(dirname "$0")/../terraform"

terraform init -backend-config="bucket=terraform-state-bucket-analysis-view-${PROJECT_ID}"

echo "📥 Importing resources that are causing 409 conflicts..."

# Import GCS bucket
if gsutil ls -b gs://${GCS_BUCKET_NAME} 2>/dev/null; then
    echo "Importing GCS bucket: ${GCS_BUCKET_NAME}"
    terraform import google_storage_bucket.datasets_bucket "${GCS_BUCKET_NAME}" || echo "Already imported or failed"
fi

# Import Cloud SQL instance
if gcloud sql instances describe analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "Importing Cloud SQL instance: analysis-db-instance"
    terraform import google_sql_database_instance.analysis_db "analysis-db-instance" || echo "Already imported or failed"
fi

# Import Secret Manager secret
if gcloud secrets describe query-engine-database-url --project=${PROJECT_ID} 2>/dev/null; then
    echo "Importing Secret Manager secret: query-engine-database-url"
    terraform import google_secret_manager_secret.query_engine_database_url "projects/${PROJECT_ID}/secrets/query-engine-database-url" || echo "Already imported or failed"
fi

# Import database within SQL instance
if gcloud sql databases describe analysis_catalog --instance=analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "Importing database: analysis_catalog"
    terraform import google_sql_database.analysis_catalog "${PROJECT_ID}/analysis-db-instance/analysis_catalog" || echo "Already imported or failed"
fi

# Import database user
if gcloud sql users describe analysis_user --instance=analysis-db-instance --project=${PROJECT_ID} 2>/dev/null; then
    echo "Importing database user: analysis_user"
    terraform import google_sql_user.analysis_user "analysis_user/analysis-db-instance/${PROJECT_ID}" || echo "Already imported or failed"
fi

echo "📋 Running terraform plan to verify imports..."
terraform plan

echo "✅ Import fix completed!"
echo ""
echo "If you still see 409 errors, check the plan output above."
echo "Resources showing 'will be created' might need manual deletion or different import format."
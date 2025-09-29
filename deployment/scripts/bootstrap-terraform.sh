#!/bin/bash

# Bootstrap script for Terraform state management and resource imports
# Usage: ./bootstrap-terraform.sh [project-id] [region] [bucket-name] [db-password]

set -e

PROJECT_ID=${1:-$TF_VAR_project_id}
REGION=${2:-$TF_VAR_region}
GCS_BUCKET_NAME=${3:-$TF_VAR_gcs_bucket_name}
DB_PASSWORD=${4:-$TF_VAR_db_password}

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

# Initialize Terraform with the state bucket
echo "🔧 Initializing Terraform..."
terraform init -backend-config="bucket=${TERRAFORM_STATE_BUCKET}"

# Run terraform plan to verify everything is configured correctly
echo "📋 Running terraform plan..."
PLAN_OUTPUT=$(terraform plan -no-color 2>&1)
echo "$PLAN_OUTPUT"

echo "✅ Terraform bootstrap completed successfully!"
echo ""
echo "🔗 State bucket: gs://${TERRAFORM_STATE_BUCKET}"
echo "📁 State file: gs://${TERRAFORM_STATE_BUCKET}/terraform/state/default.tfstate"
echo ""
echo "🚀 You can now run 'terraform apply' safely"
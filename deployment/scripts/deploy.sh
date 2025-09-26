#!/bin/bash

# Deploy Query Engine Service to Google Cloud Platform
# Usage: ./deploy.sh [project-id] [region] [bucket-name] [db-password]

set -e

# Configuration
PROJECT_ID=${1:-"your-gcp-project-id"}
REGION=${2:-"us-central1"}
GCS_BUCKET_NAME=${3:-""}
DB_PASSWORD=${4:-""}
QUERY_ENGINE_SERVICE="query-engine-service"

echo "🚀 Deploying Query Engine Service to GCP"
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service: ${QUERY_ENGINE_SERVICE}"
echo "Database: PostgreSQL (cost-optimized)"
echo ""

# Check if required parameters are provided
if [ -z "$GCS_BUCKET_NAME" ]; then
    echo "❌ GCS bucket name is required as the third parameter"
    echo "Usage: ./deploy.sh [project-id] [region] [bucket-name] [db-password]"
    exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
    echo "❌ Database password is required as the fourth parameter"
    echo "Usage: ./deploy.sh [project-id] [region] [bucket-name] [db-password]"
    exit 1
fi

# Check if required tools are installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install it first."
    exit 1
fi

if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed. Please install it first."
    exit 1
fi

# Set the project
echo "📋 Setting GCP project..."
gcloud config set project ${PROJECT_ID}

# Configure Docker authentication
echo "🔐 Configuring Docker authentication..."
gcloud auth configure-docker

# Deploy infrastructure with Terraform
echo "🏗️ Deploying infrastructure with Terraform..."
cd ../terraform

export TF_VAR_project_id=${PROJECT_ID}
export TF_VAR_region=${REGION}
export TF_VAR_gcs_bucket_name=${GCS_BUCKET_NAME}
export TF_VAR_db_password=${DB_PASSWORD}

terraform init
terraform plan
terraform apply -auto-approve

cd ../scripts

# Build and Deploy Query Engine Service
echo "🏗️ Building and deploying Query Engine Service..."
cd ../query-engine
docker build -t gcr.io/${PROJECT_ID}/${QUERY_ENGINE_SERVICE}:latest .
docker push gcr.io/${PROJECT_ID}/${QUERY_ENGINE_SERVICE}:latest

gcloud run deploy ${QUERY_ENGINE_SERVICE} \
    --image gcr.io/${PROJECT_ID}/${QUERY_ENGINE_SERVICE}:latest \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port 50051 \
    --memory 8Gi \
    --cpu 4 \
    --max-instances 5 \
    --min-instances 1 \
    --set-env-vars "GRPC_PORT=50051,GCS_BUCKET_NAME=${GCS_BUCKET_NAME},RUST_LOG=query_engine_service=info" \
    --update-secrets "DATABASE_URL=query-engine-database-url:latest" \
    --timeout 600 \
    --use-http2

# Get Query Engine URL
QUERY_ENGINE_URL=$(gcloud run services describe ${QUERY_ENGINE_SERVICE} \
    --region ${REGION} \
    --format 'value(status.url)')

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "🔗 Service URL:"
echo "   Query Engine: ${QUERY_ENGINE_URL}"
echo ""
echo "📝 The Query Engine is now ready to process gRPC requests on port 50051"
echo ""
echo "🧪 Test the deployment:"
echo "   Connect via gRPC client to: ${QUERY_ENGINE_URL}:50051"
echo ""
echo "📊 Monitor the service:"
echo "   Logs: gcloud logging read \"resource.type=cloud_run_revision AND resource.labels.service_name=${QUERY_ENGINE_SERVICE}\""
echo "   Metrics: GCP Console → Cloud Run → ${QUERY_ENGINE_SERVICE}"
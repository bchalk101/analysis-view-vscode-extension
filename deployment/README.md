# Query Engine Deployment Guide

This directory contains the deployment configuration for the **Query Engine** service on Google Cloud Platform.

## Architecture

The application consists of these main components:

1. **Query Engine Service** - Rust gRPC service that handles data processing and SQL queries
2. **PostgreSQL Database** - Cost-optimized Cloud SQL instance for metadata and catalog storage
3. **GCS Bucket** - Dataset file storage
4. **Secret Manager** - Secure storage for database credentials

## Cost-Optimized Database Strategy

For minimal costs while maintaining reliability, we use **Cloud SQL PostgreSQL** with these optimizations:

- **Instance Type**: `db-f1-micro` (smallest available)
- **Storage**: 10GB HDD (cheapest option)
- **Backups**: Disabled
- **High Availability**: Disabled
- **Estimated Cost**: ~$7-10/month for low usage

## Prerequisites

1. **Google Cloud Platform Account** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Terraform** installed
4. **GitHub Secrets** configured (for CI/CD)

## Deployment via GitHub Actions (Recommended)

The easiest way to deploy is through GitHub Actions, which handles everything automatically:

### Required GitHub Secrets

Set these secrets in your GitHub repository (`Settings` > `Secrets and variables` > `Actions`):

- `GCP_PROJECT_ID` - Your GCP project ID
- `GCP_SA_KEY` - Service account JSON key (see service account setup below)
- `GCS_BUCKET_NAME` - GCS bucket name for datasets (e.g., "my-datasets-bucket")
- `DB_PASSWORD` - Secure password for PostgreSQL database

### Automatic Deployment

Push to `main` branch with changes to:
- `query-engine/**`
- `deployment/**`
- `.github/workflows/deploy.yml`

The workflow will automatically:
1. Deploy Terraform infrastructure (PostgreSQL, GCS, Secret Manager)
2. Build and push Query Engine Docker image
3. Deploy to Cloud Run with database integration

## Manual Deployment with Terraform

### 1. Create Service Account

```bash
export PROJECT_ID="your-project-id"

# Create service account
gcloud iam service-accounts create github-actions-deploy \
    --description="Service account for deployment" \
    --display-name="Deployment Service Account"

# Grant required permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/editor"
```

### 2. Deploy Infrastructure

```bash
cd terraform
terraform init

# Set required variables
export TF_VAR_project_id="your-project-id"
export TF_VAR_gcs_bucket_name="your-unique-bucket-name"
export TF_VAR_db_password="your-secure-db-password"

terraform plan
terraform apply
```

### 3. Deploy Query Engine

```bash
# Build and push image
cd ../query-engine
docker build -t gcr.io/$PROJECT_ID/query-engine-service:latest .
docker push gcr.io/$PROJECT_ID/query-engine-service:latest

# Deploy to Cloud Run
gcloud run deploy query-engine-service \
    --image gcr.io/$PROJECT_ID/query-engine-service:latest \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --port 50051 \
    --memory 8Gi \
    --cpu 4 \
    --set-env-vars "GRPC_PORT=50051,GCS_BUCKET_NAME=your-bucket-name,RUST_LOG=query_engine_service=info" \
    --update-secrets "DATABASE_URL=query-engine-database-url:latest" \
    --timeout 600 \
    --use-http2
```

## Infrastructure Components

### PostgreSQL Database
- **Instance**: `db-f1-micro` for minimal cost
- **Storage**: 10GB HDD
- **Network**: Public IP with authorized networks
- **Credentials**: Stored in Secret Manager

### Cloud Run Service
- **Port**: 50051 (gRPC)
- **Resources**: 8Gi memory, 4 CPU
- **Scaling**: 1-5 instances
- **Environment**: PostgreSQL integration via Secret Manager

### GCS Storage
- **Datasets**: Main bucket for storing dataset files
- **Region**: us-central1 for cost optimization

## Testing the Deployment

1. **Get Service URL**:
   ```bash
   gcloud run services describe query-engine-service \
       --region us-central1 \
       --format 'value(status.url)'
   ```

2. **Test gRPC Connection**:
   The Query Engine serves gRPC on port 50051. You can test it with a gRPC client or through the VS Code extension.

## Monitoring and Logs

- **Cloud Run Logs**: View in GCP Console under Cloud Run → query-engine-service
- **Database Monitoring**: Cloud SQL instance metrics in GCP Console
- **Error Reporting**: Automatic error tracking and alerting

## Cost Optimization

**Estimated Monthly Costs for Low Usage:**
- PostgreSQL (db-f1-micro): $7-10/month
- Cloud Run: $0-5/month (free tier covers most usage)
- GCS Storage: $0.02-0.50/month
- Secret Manager: $0.06/month
- Container Registry: $0.10/month
- **Total**: ~$7-16/month

**Cost-Saving Features:**
- Auto-scaling to zero when not in use
- Smallest possible database instance
- Single region deployment
- HDD storage instead of SSD
- Disabled database backups and HA

## Security

- **Database**: Private network access with authorized IPs
- **Credentials**: All secrets stored in Secret Manager
- **Cloud Run**: HTTPS/TLS encryption
- **IAM**: Least-privilege service account permissions

## Troubleshooting

### Common Issues

1. **Database Connection Errors**:
   - Check Secret Manager contains valid DATABASE_URL
   - Verify database instance is running
   - Confirm authorized networks in Cloud SQL

2. **gRPC Connection Issues**:
   - Ensure Cloud Run is configured with `--use-http2`
   - Check port 50051 is properly exposed
   - Verify service is allowing unauthenticated access

3. **Permission Errors**:
   - Verify service account has required roles
   - Check Cloud Run service account can access Secret Manager

### Debug Commands

```bash
# Check service status
gcloud run services describe query-engine-service --region=us-central1

# View recent logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=query-engine-service" --limit=50

# Check database connectivity
gcloud sql instances describe analysis-db-instance

# Test Secret Manager access
gcloud secrets versions access latest --secret=query-engine-database-url
```

For additional support, check the project documentation or create an issue in the GitHub repository.
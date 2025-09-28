use object_store::{gcp::GoogleCloudStorageBuilder, ObjectStore};
use std::sync::Arc;
use crate::error::AnalysisError;

pub fn create_gcs_client(bucket_name: &str) -> Result<Arc<dyn ObjectStore>, AnalysisError> {
    let mut builder = GoogleCloudStorageBuilder::new()
        .with_bucket_name(bucket_name);

    if let Ok(service_account_path) = std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
        builder = builder.with_service_account_path(service_account_path);
    }

    let store = builder.build()
        .map_err(|e| AnalysisError::ConfigError {
            message: format!("Failed to create GCS client for bucket '{}': {}", bucket_name, e),
        })?;

    Ok(Arc::new(store))
}
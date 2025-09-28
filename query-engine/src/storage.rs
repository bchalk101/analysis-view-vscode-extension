use futures::StreamExt;
use object_store::{
    aws::AmazonS3Builder, path::Path as ObjectPath,
    MultipartUpload, ObjectStore,
};
use std::sync::Arc;
use tracing::info;
use url::Url;

use crate::error::AnalysisError;
use crate::gcs_client::create_gcs_client;

#[derive(Debug)]
pub struct DatasetStorage {
    store: Arc<dyn ObjectStore>,
    bucket_name: String,
}

impl DatasetStorage {
    pub async fn new(bucket_name: String) -> Result<Self, AnalysisError> {
        info!(
            "Initializing GCP Cloud Storage client for bucket: {}",
            bucket_name
        );

        let store = create_gcs_client(&bucket_name)?;

        Ok(Self {
            store,
            bucket_name,
        })
    }

    pub async fn copy_from_external_storage(
        &self,
        source_path: &str,
        dataset_id: &str,
        filename: &str,
    ) -> Result<String, AnalysisError> {
        info!(
            "Copying dataset from {} to {}/{}",
            source_path, dataset_id, filename
        );

        let source_url = Url::parse(source_path).map_err(|e| AnalysisError::ConfigError {
            message: format!("Invalid source path URL: {}", e),
        })?;

        let source_store: Arc<dyn ObjectStore> = match source_url.scheme() {
            "s3" => {
                let bucket = source_url
                    .host_str()
                    .ok_or_else(|| AnalysisError::ConfigError {
                        message: "Invalid S3 URL: missing bucket".to_string(),
                    })?;

                info!("Creating S3 client for bucket: {}", bucket);
                let s3_store = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .build()
                    .map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to create S3 client: {}", e),
                    })?;

                Arc::new(s3_store)
            }
            "gs" => {
                let bucket = source_url
                    .host_str()
                    .ok_or_else(|| AnalysisError::ConfigError {
                        message: "Invalid GCS URL: missing bucket".to_string(),
                    })?;

                info!("Creating GCS client for bucket: {}", bucket);
                create_gcs_client(bucket)?
            }
            scheme => {
                return Err(AnalysisError::ConfigError {
                    message: format!("Unsupported storage scheme: {}", scheme),
                });
            }
        };

        let source_object_path = ObjectPath::from(source_url.path().trim_start_matches('/'));
        let dest_path = ObjectPath::from(format!("datasets/{}/{}", dataset_id, filename));

        info!(
            "Streaming from source {} to destination {}",
            source_object_path, dest_path
        );

        let copy_result = self.store.copy(&source_object_path, &dest_path).await;

        match copy_result {
            Ok(_) => {
                info!("Successfully streamed dataset using direct copy");
            }
            Err(_) => {
                info!("Direct copy not supported, falling back to streaming copy");

                let get_result = source_store.get(&source_object_path).await.map_err(|e| {
                    AnalysisError::ConfigError {
                        message: format!("Failed to open source stream {}: {}", source_path, e),
                    }
                })?;

                let source_stream = get_result.into_stream();

                info!("Starting multipart streaming upload to destination");

                let mut multipart = self.store.put_multipart(&dest_path).await.map_err(|e| {
                    AnalysisError::ConfigError {
                        message: format!("Failed to initiate multipart upload: {}", e),
                    }
                })?;

                let mut total_bytes = 0u64;
                let mut part_number = 0;

                let mut stream = source_stream;
                while let Some(chunk_result) = stream.next().await {
                    let chunk = chunk_result.map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to read chunk from source stream: {}", e),
                    })?;

                    multipart
                        .put_part(chunk.clone().into())
                        .await
                        .map_err(|e| AnalysisError::ConfigError {
                            message: format!("Failed to upload part {}: {}", part_number, e),
                        })?;

                    total_bytes += chunk.len() as u64;
                    part_number += 1;
                }

                multipart
                    .complete()
                    .await
                    .map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to complete multipart upload: {}", e),
                    })?;

                info!(
                    "Successfully completed multipart streaming upload of {} bytes",
                    total_bytes
                );
            }
        }

        let storage_path = format!("gs://{}/{}", self.bucket_name, dest_path);
        info!("Successfully copied dataset to {}", storage_path);

        Ok(storage_path)
    }
}

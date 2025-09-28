use chrono::Utc;
use futures::StreamExt;
use object_store::{aws::AmazonS3Builder};
use object_store::{path::Path as ObjectPath, ObjectStore};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{info, warn};
use url::Url;

use crate::catalog::{CatalogDatasetEntry, DataFormat, DatasetFile, DatasetMetadataFile};
use crate::database::DatabaseManager;
use crate::error::AnalysisError;
use crate::gcs_client::create_gcs_client;
use crate::proto::analysis::{ColumnInfo, Dataset, DatasetMetadata};
use crate::storage::DatasetStorage;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DatasetInfo {
    pub id: String,
    pub format: DataFormat,
    pub files: Vec<DatasetFile>,
}

pub struct DatasetManager {
    storage: DatasetStorage,
    database: DatabaseManager,
}

impl DatasetManager {
    pub async fn new(bucket_name: String, database_url: String) -> Result<Self, AnalysisError> {
        let storage = DatasetStorage::new(bucket_name).await?;
        let database = DatabaseManager::new(&database_url).await?;

        Ok(Self { storage, database })
    }

    fn is_file_path(path: &str) -> bool {
        let filename = path.split('/').next_back().unwrap_or("");
        filename.contains('.') && !filename.ends_with('/')
    }

    async fn create_source_store_from_url(
        &self,
        source_url: &Url,
    ) -> Result<Arc<dyn object_store::ObjectStore>, AnalysisError> {
        match source_url.scheme() {
            "s3" => {
                let bucket = source_url
                    .host_str()
                    .ok_or_else(|| AnalysisError::ConfigError {
                        message: "Invalid S3 URL: missing bucket".to_string(),
                    })?;

                let s3_store = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .build()
                    .map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to create S3 client: {}", e),
                    })?;

                Ok(Arc::new(s3_store))
            }
            "gs" => {
                let bucket = source_url
                    .host_str()
                    .ok_or_else(|| AnalysisError::ConfigError {
                        message: "Invalid GCS URL: missing bucket".to_string(),
                    })?;

                Ok(create_gcs_client(bucket)?)
            }
            scheme => Err(AnalysisError::ConfigError {
                message: format!("Unsupported storage scheme: {}", scheme),
            }),
        }
    }

    pub async fn add_dataset_from_external_path(
        &self,
        name: String,
        source_path: String,
        description: Option<String>,
        tags: Option<Vec<String>>,
        format: Option<DataFormat>,
    ) -> Result<String, AnalysisError> {
        info!(
            "Adding dataset from external path: {} ({})",
            name, source_path
        );

        let dataset_id = format!("ds_{}", Uuid::new_v4().simple());
        let now = Utc::now();
        let dataset_uuid = Uuid::new_v4();

        let dataset_files = if Self::is_file_path(&source_path) {
            let filename = source_path
                .split('/')
                .next_back()
                .unwrap_or("data")
                .to_string();

            let storage_path = self
                .storage
                .copy_from_external_storage(&source_path, &dataset_id, &filename)
                .await?;

            vec![DatasetFile {
                filename,
                storage_path,
                size_bytes: 0,
                row_count: 0,
                created_at: now,
            }]
        } else {
            let source_url = Url::parse(&source_path).map_err(|e| AnalysisError::ConfigError {
                message: format!("Invalid source path URL: {}", e),
            })?;

            let source_store = self.create_source_store_from_url(&source_url).await?;
            let source_prefix = source_url.path().trim_start_matches('/');

            let file_objects = {
                let prefix_path = ObjectPath::from(source_prefix);
                let mut objects = Vec::new();
                let mut stream = source_store.list(Some(&prefix_path));

                while let Some(result) = stream.next().await {
                    match result {
                        Ok(meta) => {
                            let path_str = meta.location.to_string();
                            if Self::is_file_path(&path_str) {
                                objects.push(path_str);
                            }
                        }
                        Err(e) => {
                            return Err(AnalysisError::ConfigError {
                                message: format!("Failed to list objects: {}", e),
                            });
                        }
                    }
                }
                objects
            };

            if file_objects.is_empty() {
                return Err(AnalysisError::ConfigError {
                    message: format!("No files found in directory: {}", source_path),
                });
            }

            let mut dataset_files = Vec::new();
            for file_path in file_objects {
                let filename = file_path
                    .split('/')
                    .next_back()
                    .unwrap_or("data")
                    .to_string();
                let full_source_path = format!(
                    "{}://{}/{}",
                    source_url.scheme(),
                    source_url.host_str().unwrap_or(""),
                    file_path
                );

                let storage_path = self
                    .storage
                    .copy_from_external_storage(&full_source_path, &dataset_id, &filename)
                    .await?;

                dataset_files.push(DatasetFile {
                    filename,
                    storage_path,
                    size_bytes: 0,
                    row_count: 0,
                    created_at: now,
                });
            }
            dataset_files
        };

        let detected_format = format.unwrap_or_else(|| {
            if dataset_files
                .iter()
                .any(|f| f.filename.ends_with(".parquet"))
            {
                DataFormat::Parquet
            } else {
                DataFormat::Csv
            }
        });

        let dataset_path = format!("datasets/{}", dataset_id);

        let metadata = DatasetMetadataFile {
            id: dataset_id.clone(),
            uuid: dataset_uuid,
            name: name.clone(),
            description: description
                .unwrap_or_else(|| format!("Dataset imported from {}", source_path)),
            format: detected_format.clone(),
            size_bytes: 0,
            row_count: 0,
            tags: tags.unwrap_or_default(),
            created_at: now,
            updated_at: now,
            dataset_path: dataset_path.clone(),
            files: dataset_files,
            columns: vec![],
            statistics: HashMap::new(),
        };

        let metadata_path = format!("datasets/{}/metadata.json", dataset_id);

        let catalog_entry = CatalogDatasetEntry {
            id: dataset_id.clone(),
            uuid: dataset_uuid,
            name,
            description: metadata.description.clone(),
            format: detected_format,
            size_bytes: 0,
            row_count: 0,
            tags: metadata.tags.clone(),
            created_at: now,
            updated_at: now,
            dataset_path,
            metadata_path,
        };

        self.database.add_dataset(&catalog_entry).await?;
        self.database.save_metadata(&metadata).await?;

        info!(
            "Dataset {} added successfully from external path",
            dataset_id
        );
        Ok(dataset_id)
    }

    pub async fn list_datasets(&self) -> Vec<Dataset> {
        match self.database.list_datasets().await {
            Ok(datasets) => datasets
                .iter()
                .map(|entry| Dataset {
                    id: entry.id.clone(),
                    name: entry.name.clone(),
                    description: entry.description.clone(),
                    file_path: entry.dataset_path.clone(),
                    format: entry.format.as_str().to_string(),
                    size_bytes: entry.size_bytes,
                    row_count: entry.row_count,
                    tags: entry.tags.clone(),
                    created_at: entry.created_at.to_rfc3339(),
                    updated_at: entry.updated_at.to_rfc3339(),
                })
                .collect(),
            Err(e) => {
                warn!("Failed to load datasets from database: {}", e);
                Vec::new()
            }
        }
    }

    pub async fn get_dataset(&self, dataset_id: &str) -> Option<DatasetInfo> {
        match self.database.load_metadata(dataset_id).await {
            Ok(metadata) => Some(DatasetInfo {
                id: metadata.id.clone(),
                format: metadata.format.clone(),
                files: metadata.files,
            }),
            Err(e) => {
                warn!("Failed to load dataset metadata from database: {}", e);
                None
            }
        }
    }

    pub async fn get_metadata(&self, dataset_id: &str) -> Result<DatasetMetadata, AnalysisError> {
        let _entry = self
            .database
            .get_dataset(dataset_id)
            .await?
            .ok_or_else(|| AnalysisError::DatasetNotFound {
                dataset_id: dataset_id.to_string(),
            })?;

        let metadata = self.database.load_metadata(dataset_id).await?;

        Ok(DatasetMetadata {
            id: metadata.id,
            name: metadata.name,
            description: metadata.description,
            columns: metadata
                .columns
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name.clone(),
                    data_type: col.data_type.clone(),
                    nullable: col.nullable,
                    description: col.description.clone(),
                    statistics: col.statistics.clone(),
                })
                .collect(),
            row_count: metadata.row_count,
            size_bytes: metadata.size_bytes,
            format: metadata.format.as_str().to_string(),
            tags: metadata.tags,
            statistics: metadata.statistics,
            created_at: metadata.created_at.to_rfc3339(),
            updated_at: metadata.updated_at.to_rfc3339(),
        })
    }
}

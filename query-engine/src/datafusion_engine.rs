use datafusion::arrow::ipc::writer::StreamWriter;
use datafusion::catalog::{CatalogProvider, MemoryCatalogProvider, MemorySchemaProvider};
use datafusion::datasource::file_format::csv::CsvFormat;
use datafusion::datasource::file_format::json::JsonFormat;
use datafusion::datasource::file_format::parquet::ParquetFormat;
use datafusion::datasource::listing::{
    ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl,
};
use datafusion::execution::config::SessionConfig;
use datafusion::execution::context::SessionContext;
use datafusion::execution::object_store::ObjectStoreUrl;
use datafusion::execution::runtime_env::RuntimeEnvBuilder;
use object_store::{aws::AmazonS3Builder, gcp::GoogleCloudStorageBuilder, ObjectStore};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use url::Url;

use crate::dataset_manager::DatasetInfo;
use crate::domain::{ColumnInfo, QueryDataChunk, QueryMetadata, QueryStreamResult};
use crate::error::AnalysisError;

pub struct DataFusionEngine {
    ctx: SessionContext,
    registered_buckets: Arc<RwLock<HashSet<String>>>,
}

impl DataFusionEngine {
    async fn get_table(
        &self,
        dataset_id: &str,
    ) -> Result<Arc<dyn datafusion::catalog::TableProvider>, AnalysisError> {
        self.ctx
            .catalog("agentic_analytics")
            .ok_or_else(|| AnalysisError::ConfigError {
                message: "agentic_analytics catalog not found".to_string(),
            })?
            .schema("public")
            .ok_or_else(|| AnalysisError::ConfigError {
                message: "public schema not found in agentic_analytics catalog".to_string(),
            })?
            .table(dataset_id)
            .await?
            .ok_or_else(|| AnalysisError::DatasetNotFound {
                dataset_id: format!("Table {} not found", dataset_id),
            })
    }

    pub async fn new(bucket_name: String) -> Result<Self, AnalysisError> {
        info!(
            "Initializing DataFusion engine with GCS bucket: {}",
            bucket_name
        );

        let max_memory = 8 * 1024 * 1024 * 1024;
        let memory_fraction = 0.8;

        let runtime_builder =
            RuntimeEnvBuilder::new().with_memory_limit(max_memory, memory_fraction);

        let runtime_config = runtime_builder
            .build()
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to build DataFusion runtime environment: {}", e),
            })?;

        let session_config = SessionConfig::new();

        let ctx = SessionContext::new_with_config_rt(session_config, runtime_config.into());

        let catalog = Arc::new(MemoryCatalogProvider::new());
        let schema = Arc::new(MemorySchemaProvider::new());
        let _ = catalog.register_schema("public", schema)?;
        ctx.register_catalog("agentic_analytics", catalog);

        info!("DataFusion engine initialized successfully");

        Ok(Self {
            ctx,
            registered_buckets: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    pub async fn register_dataset(&self, dataset: &DatasetInfo) -> Result<(), AnalysisError> {
        let file_path = if !dataset.files.is_empty() {
            dataset.files[0].storage_path.clone()
        } else {
            return Err(AnalysisError::ConfigError {
                message: format!("No files found for dataset {}", dataset.id),
            });
        };

        self.register_object_store(file_path.clone()).await?;

        let table_url = ListingTableUrl::parse(&file_path)?;
        let listing_options = match dataset.format.as_str() {
            "csv" => {
                let csv_format = CsvFormat::default()
                    .with_has_header(true)
                    .with_delimiter(b',');
                ListingOptions::new(Arc::new(csv_format))
            }
            "json" => {
                let json_format = JsonFormat::default();
                ListingOptions::new(Arc::new(json_format))
            }
            "parquet" => {
                let parquet_format = ParquetFormat::default();
                ListingOptions::new(Arc::new(parquet_format))
            }
            _ => {
                return Err(AnalysisError::ConfigError {
                    message: format!("Unsupported file format: {}", dataset.format),
                });
            }
        };

        let mut config = ListingTableConfig::new(table_url).with_listing_options(listing_options);
        config = config.infer_schema(&self.ctx.state()).await?;

        let table = ListingTable::try_new(config)?;

        let catalog =
            self.ctx
                .catalog("agentic_analytics")
                .ok_or_else(|| AnalysisError::ConfigError {
                    message: "agentic_analytics catalog not found".to_string(),
                })?;
        let schema = catalog
            .schema("public")
            .ok_or_else(|| AnalysisError::ConfigError {
                message: "public schema not found in agentic_analytics catalog".to_string(),
            })?;
        schema.register_table(dataset.id.to_string(), Arc::new(table))?;

        info!("Registered dataset '{}' with DataFusion", dataset.id);
        Ok(())
    }

    pub async fn is_dataset_registered(&self, dataset_id: &str) -> bool {
        self.get_table(dataset_id).await.is_ok()
    }

    pub async fn get_table_schema(
        &self,
        dataset_id: &str,
    ) -> Result<Vec<ColumnInfo>, AnalysisError> {
        let table = self.get_table(dataset_id).await?;

        let schema = table.schema();
        let arrow_schema = &*schema;
        let columns =
            arrow_schema
                .fields()
                .iter()
                .map(|field| ColumnInfo {
                    name: field.name().clone(),
                    data_type: self.datafusion_type_to_string(field.data_type()),
                    nullable: field.is_nullable(),
                    description: field.metadata().get("description").cloned().unwrap_or_else(
                        || {
                            format!(
                                "Column of type {}",
                                self.datafusion_type_to_string(field.data_type())
                            )
                        },
                    ),
                    statistics: std::collections::HashMap::new(),
                })
                .collect();

        Ok(columns)
    }

    pub async fn execute_query(
        &self,
        dataset_id: &str,
        sql_query: &str,
        limit: Option<i32>,
    ) -> Result<QueryStreamResult, AnalysisError> {
        let start_time = std::time::Instant::now();

        info!("Executing query on dataset '{}': {}", dataset_id, sql_query);

        let table_provider = self.get_table(dataset_id).await?;

        self.ctx.register_table("base", table_provider)?;

        let mut query = sql_query.to_string();

        if let Some(limit_val) = limit {
            if !query.to_lowercase().contains("limit") {
                query = format!("{} LIMIT {}", query, limit_val);
            }
        }

        let df = self
            .ctx
            .sql(&query)
            .await
            .map_err(|e| AnalysisError::InvalidSqlQuery {
                message: e.to_string(),
            })?;

        let batches = df
            .collect()
            .await
            .map_err(|e| AnalysisError::QueryExecutionFailed {
                message: e.to_string(),
            })?;

        let mut chunks = Vec::new();
        let mut metadata = None;

        if !batches.is_empty() {
            let schema = batches[0].schema();

            let mut schema_bytes = Vec::new();
            {
                let mut writer = StreamWriter::try_new(&mut schema_bytes, &schema)?;
                writer.finish()?;
            }

            metadata = Some(QueryMetadata {
                arrow_schema: schema_bytes,
                column_names: schema.fields().iter().map(|f| f.name().clone()).collect(),
                estimated_rows: batches.iter().map(|b| b.num_rows() as i32).sum(),
            });

            const CHUNK_SIZE: usize = 1000;
            let mut chunk_index = 0;

            for batch in batches {
                let mut start_row = 0;
                while start_row < batch.num_rows() {
                    let end_row = std::cmp::min(start_row + CHUNK_SIZE, batch.num_rows());
                    let chunk_batch = batch.slice(start_row, end_row - start_row);

                    let mut chunk_data = Vec::new();
                    {
                        let mut writer = StreamWriter::try_new(&mut chunk_data, &schema)?;
                        writer.write(&chunk_batch)?;
                        writer.finish()?;
                    }

                    chunks.push(QueryDataChunk {
                        arrow_ipc_data: chunk_data,
                        chunk_rows: chunk_batch.num_rows() as i32,
                        chunk_index,
                    });

                    chunk_index += 1;
                    start_row = end_row;
                }
            }
        }

        let total_rows: i32 = chunks.iter().map(|c| c.chunk_rows).sum();
        info!(
            "Query completed. Generated {} chunks with {} total rows in {}ms",
            chunks.len(),
            total_rows,
            start_time.elapsed().as_millis()
        );

        Ok(QueryStreamResult { metadata, chunks })
    }

    pub async fn health_check(&self) -> Result<(), AnalysisError> {
        let _ = self.ctx.sql("SELECT 1 as health_check").await?;
        Ok(())
    }

    fn datafusion_type_to_string(
        &self,
        data_type: &datafusion::arrow::datatypes::DataType,
    ) -> String {
        use datafusion::arrow::datatypes::DataType;

        match data_type {
            DataType::Boolean => "Boolean".to_string(),
            DataType::Int8 => "Int8".to_string(),
            DataType::Int16 => "Int16".to_string(),
            DataType::Int32 => "Int32".to_string(),
            DataType::Int64 => "Int64".to_string(),
            DataType::UInt8 => "UInt8".to_string(),
            DataType::UInt16 => "UInt16".to_string(),
            DataType::UInt32 => "UInt32".to_string(),
            DataType::UInt64 => "UInt64".to_string(),
            DataType::Float16 => "Float16".to_string(),
            DataType::Float32 => "Float32".to_string(),
            DataType::Float64 => "Float64".to_string(),
            DataType::Timestamp(unit, tz) => match tz {
                Some(tz) => format!("Timestamp({:?}, {})", unit, tz),
                None => format!("Timestamp({:?})", unit),
            },
            DataType::Date32 => "Date32".to_string(),
            DataType::Date64 => "Date64".to_string(),
            DataType::Time32(unit) => format!("Time32({:?})", unit),
            DataType::Time64(unit) => format!("Time64({:?})", unit),
            DataType::Duration(unit) => format!("Duration({:?})", unit),
            DataType::Interval(unit) => format!("Interval({:?})", unit),
            DataType::Binary => "Binary".to_string(),
            DataType::FixedSizeBinary(size) => format!("FixedSizeBinary({})", size),
            DataType::LargeBinary => "LargeBinary".to_string(),
            DataType::Utf8 => "String".to_string(),
            DataType::LargeUtf8 => "LargeString".to_string(),
            DataType::List(field) => format!(
                "List({})",
                self.datafusion_type_to_string(field.data_type())
            ),
            DataType::FixedSizeList(field, size) => format!(
                "FixedSizeList({}, {})",
                self.datafusion_type_to_string(field.data_type()),
                size
            ),
            DataType::LargeList(field) => format!(
                "LargeList({})",
                self.datafusion_type_to_string(field.data_type())
            ),
            DataType::Struct(fields) => {
                let field_types: Vec<String> = fields
                    .iter()
                    .map(|f| {
                        format!(
                            "{}: {}",
                            f.name(),
                            self.datafusion_type_to_string(f.data_type())
                        )
                    })
                    .collect();
                format!("Struct({})", field_types.join(", "))
            }
            DataType::Union(_, _) => "Union".to_string(),
            DataType::Dictionary(key_type, value_type) => {
                format!(
                    "Dictionary({}, {})",
                    self.datafusion_type_to_string(key_type),
                    self.datafusion_type_to_string(value_type)
                )
            }
            DataType::Decimal128(precision, scale) => {
                format!("Decimal128({}, {})", precision, scale)
            }
            DataType::Decimal256(precision, scale) => {
                format!("Decimal256({}, {})", precision, scale)
            }
            DataType::Map(field, sorted) => format!(
                "Map({}, sorted: {})",
                self.datafusion_type_to_string(field.data_type()),
                sorted
            ),
            DataType::RunEndEncoded(_, _) => "RunEndEncoded".to_string(),
            _ => format!("{:?}", data_type),
        }
    }

    pub fn get_object_store_url(base_path: &str) -> Result<ObjectStoreUrl, AnalysisError> {
        let url = Url::parse(base_path).map_err(|origin| {
            warn!("Could not parse base path {}", origin);
            AnalysisError::ConfigError {
                message: format!("Invalid dataset path: {}", base_path),
            }
        })?;
        ObjectStoreUrl::parse(&format!("{}://{}", url.scheme(), url.host_str().unwrap())).map_err(
            |origin| {
                warn!("Could not parse base path to object store url: {}", origin);
                AnalysisError::ConfigError {
                    message: format!("Invalid dataset path: {}", base_path),
                }
            },
        )
    }

    pub async fn register_object_store(
        &self,
        dataset_path: String,
    ) -> Result<Arc<dyn ObjectStore>, AnalysisError> {
        if self.registered_buckets.read().await.contains(&dataset_path) {
            let object_store_url = Self::get_object_store_url(dataset_path.as_str())?;
            let object_store = self
                .ctx
                .runtime_env()
                .object_store(object_store_url)
                .map_err(|origin| {
                    error!(exception = ?origin, "Error getting object store");
                    AnalysisError::InternalError {
                        message: "Error getting object store".to_string(),
                    }
                })?;
            return Ok(object_store);
        }

        let object_store_url = Self::get_object_store_url(&dataset_path)?;
        let url = Url::parse(&dataset_path).map_err(|e| AnalysisError::ConfigError {
            message: format!("Invalid dataset path URL: {}", e),
        })?;

        let object_store: Arc<dyn ObjectStore> = match url.scheme() {
            "s3" => {
                let bucket = url.host_str().ok_or_else(|| AnalysisError::ConfigError {
                    message: "Invalid S3 URL: missing bucket".to_string(),
                })?;
                let s3_store = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .build()
                    .map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to create S3 client: {}", e),
                    })?;
                Arc::new(s3_store)
            }
            "gs" => {
                let bucket = url.host_str().ok_or_else(|| AnalysisError::ConfigError {
                    message: "Invalid GCS URL: missing bucket".to_string(),
                })?;
                let gcs_store = GoogleCloudStorageBuilder::new()
                    .with_bucket_name(bucket)
                    .build()
                    .map_err(|e| AnalysisError::ConfigError {
                        message: format!("Failed to create GCS client: {}", e),
                    })?;
                Arc::new(gcs_store)
            }
            scheme => {
                return Err(AnalysisError::ConfigError {
                    message: format!("Unsupported storage scheme: {}", scheme),
                });
            }
        };

        self.ctx
            .register_object_store(object_store_url.as_ref(), object_store.clone());
        self.registered_buckets.write().await.insert(dataset_path);
        Ok(object_store)
    }
}

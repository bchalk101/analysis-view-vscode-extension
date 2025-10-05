use tracing::info;

use crate::catalog::DataFormat;
use crate::datafusion_engine::DataFusionEngine;
use crate::dataset_manager::DatasetManager;
use crate::domain::QueryStreamResult;
use crate::error::AnalysisError;

pub struct AnalysisEngine {
    datafusion: DataFusionEngine,
    dataset_manager: DatasetManager,
}

impl AnalysisEngine {
    pub async fn new(bucket_name: String, database_url: String) -> Result<Self, AnalysisError> {
        info!("Initializing Analysis Engine");

        let datafusion = DataFusionEngine::new(bucket_name.clone()).await?;
        let dataset_manager = DatasetManager::new(bucket_name, database_url).await?;

        info!("Analysis Engine initialized successfully");

        Ok(Self {
            datafusion,
            dataset_manager,
        })
    }

    async fn register_dataset_with_datafusion(
        &self,
        dataset_id: &str,
    ) -> Result<(), AnalysisError> {
        let dataset = self
            .dataset_manager
            .get_dataset(dataset_id)
            .await
            .ok_or_else(|| AnalysisError::DatasetNotFound {
                dataset_id: dataset_id.to_string(),
            })?;

        self.datafusion.register_dataset(&dataset).await
    }

    pub async fn execute_query(
        &self,
        dataset_id: &str,
        sql_query: &str,
        limit: Option<i32>,
    ) -> Result<QueryStreamResult, AnalysisError> {
        if !self.datafusion.is_dataset_registered(dataset_id).await {
            self.register_dataset_with_datafusion(dataset_id).await?;
        }

        self.datafusion
            .execute_query(dataset_id, dataset_id, sql_query, limit)
            .await
    }

    pub async fn list_datasets(&self) -> Vec<crate::proto::analysis::Dataset> {
        self.dataset_manager.list_datasets().await
    }

    pub async fn get_metadata(
        &self,
        dataset_id: &str,
    ) -> Result<crate::proto::analysis::DatasetMetadata, AnalysisError> {
        let mut metadata = self.dataset_manager.get_metadata(dataset_id).await?;

        if !self.datafusion.is_dataset_registered(dataset_id).await {
            self.register_dataset_with_datafusion(dataset_id).await?;
        }

        let domain_columns = self.datafusion.get_table_schema(dataset_id).await?;
        metadata.columns = domain_columns.into_iter().map(|col| col.into()).collect();

        Ok(metadata)
    }

    pub async fn add_dataset_from_external_path(
        &self,
        name: String,
        source_path: String,
        description: Option<String>,
        tags: Option<Vec<String>>,
        format: Option<String>,
    ) -> Result<String, AnalysisError> {
        let format_enum = format.map(|f| match f.to_lowercase().as_str() {
            "parquet" => DataFormat::Parquet,
            _ => DataFormat::Csv,
        });

        let dataset_id = self
            .dataset_manager
            .add_dataset_from_external_path(name, source_path, description, tags, format_enum)
            .await?;

        self.register_dataset_with_datafusion(&dataset_id).await?;

        Ok(dataset_id)
    }

    pub async fn health_check(&self) -> Result<(), AnalysisError> {
        self.datafusion.health_check().await
    }
}

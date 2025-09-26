use diesel::prelude::*;
use diesel_async::{
    pooled_connection::{deadpool::Pool, AsyncDieselConnectionManager},
    AsyncConnection, AsyncPgConnection, RunQueryDsl,
};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use std::collections::HashMap;
use tracing::info;

use crate::catalog::{
    CatalogDatasetEntry, ColumnMetadata, DataFormat, DatasetFile, DatasetMetadataFile,
};
use crate::error::AnalysisError;
use crate::models::*;
use crate::schema::*;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

#[derive(Clone)]
pub struct DatabaseManager {
    pool: Pool<AsyncPgConnection>,
}

impl DatabaseManager {
    pub async fn new(database_url: &str) -> Result<Self, AnalysisError> {
        let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);
        let pool = Pool::builder(config)
            .build()
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to create database pool: {}", e),
            })?;

        let manager = Self { pool };
        manager.run_migrations(database_url).await?;

        Ok(manager)
    }

    pub async fn run_migrations(&self, database_url: &str) -> Result<(), AnalysisError> {
        use diesel::Connection;
        use diesel::PgConnection;

        // For migrations, we need to use a synchronous connection
        // This is a limitation of diesel_migrations which doesn't support async yet

        let mut connection =
            PgConnection::establish(&database_url).map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to establish connection for migrations: {}", e),
            })?;

        connection
            .run_pending_migrations(MIGRATIONS)
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to run migrations: {}", e),
            })?;

        Ok(())
    }

    pub async fn add_dataset(&self, entry: &CatalogDatasetEntry) -> Result<(), AnalysisError> {
        use crate::schema::datasets::dsl::*;
        info!("Adding dataset {} to catalog", entry.name);
        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to get database connection: {}", e),
            })?;

        let new_dataset = NewDataset {
            id: &entry.id,
            uuid: &entry.uuid,
            name: &entry.name,
            description: &entry.description,
            format: entry.format.as_str(),
            size_bytes: entry.size_bytes,
            row_count: entry.row_count,
            tags: &entry.tags,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            dataset_path: &entry.dataset_path,
            metadata_path: &entry.metadata_path,
        };

        diesel_async::RunQueryDsl::execute(
            diesel::insert_into(datasets).values(&new_dataset),
            &mut conn,
        )
        .await
        .map_err(|e| AnalysisError::ConfigError {
            message: format!("Failed to insert dataset: {}", e),
        })?;

        Ok(())
    }

    pub async fn get_dataset(
        &self,
        dataset_id: &str,
    ) -> Result<Option<CatalogDatasetEntry>, AnalysisError> {
        use crate::schema::datasets::dsl::*;

        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to get database connection: {}", e),
            })?;

        let dataset = datasets
            .filter(id.eq(dataset_id))
            .get_result::<Dataset>(&mut conn)
            .await
            .optional()
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to fetch dataset: {}", e),
            })?;

        Ok(dataset.map(|d| d.into()))
    }

    pub async fn list_datasets(&self) -> Result<Vec<CatalogDatasetEntry>, AnalysisError> {
        use crate::schema::datasets::dsl::*;

        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to get database connection: {}", e),
            })?;

        let dataset_list = datasets
            .order(created_at.desc())
            .get_results::<Dataset>(&mut conn)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to fetch datasets: {}", e),
            })?;

        Ok(dataset_list.into_iter().map(|d| d.into()).collect())
    }

    pub async fn save_metadata(&self, metadata: &DatasetMetadataFile) -> Result<(), AnalysisError> {
        info!("Saving metadata for dataset {}", metadata.id);
        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to get database connection: {}", e),
            })?;

        conn.transaction::<_, AnalysisError, _>(|conn| {
            Box::pin(async move {
                for file in &metadata.files {
                    let new_file = NewDatasetFile {
                        dataset_id: &metadata.id,
                        filename: &file.filename,
                        storage_path: &file.storage_path,
                        size_bytes: file.size_bytes,
                        row_count: file.row_count,
                        created_at: file.created_at,
                    };

                    diesel::insert_into(dataset_files::table)
                        .values(&new_file)
                        .execute(conn)
                        .await
                        .map_err(|e| AnalysisError::ConfigError {
                            message: format!("Failed to insert dataset file: {}", e),
                        })?;
                }

                for column in &metadata.columns {
                    let statistics_json =
                        serde_json::to_value(&column.statistics).map_err(|e| {
                            AnalysisError::ConfigError {
                                message: format!("Failed to serialize column statistics: {}", e),
                            }
                        })?;

                    let new_column = NewDatasetColumn {
                        dataset_id: &metadata.id,
                        name: &column.name,
                        data_type: &column.data_type,
                        nullable: column.nullable,
                        description: &column.description,
                        statistics: &statistics_json,
                    };

                    diesel::insert_into(dataset_columns::table)
                        .values(&new_column)
                        .execute(conn)
                        .await
                        .map_err(|e| AnalysisError::ConfigError {
                            message: format!("Failed to insert dataset column: {}", e),
                        })?;
                }

                for (key, value) in &metadata.statistics {
                    let new_stat = NewDatasetStatistic {
                        dataset_id: &metadata.id,
                        stat_key: key,
                        stat_value: value,
                    };

                    diesel::insert_into(dataset_statistics::table)
                        .values(&new_stat)
                        .on_conflict((dataset_statistics::dataset_id, dataset_statistics::stat_key))
                        .do_update()
                        .set(dataset_statistics::stat_value.eq(value))
                        .execute(conn)
                        .await
                        .map_err(|e| AnalysisError::ConfigError {
                            message: format!("Failed to insert dataset statistic: {}", e),
                        })?;
                }

                Ok(())
            })
        })
        .await
    }

    pub async fn load_metadata(
        &self,
        dataset_id: &str,
    ) -> Result<DatasetMetadataFile, AnalysisError> {
        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to get database connection: {}", e),
            })?;

        let dataset = datasets::table
            .filter(datasets::id.eq(dataset_id))
            .get_result::<Dataset>(&mut conn)
            .await
            .map_err(|e| AnalysisError::DatasetNotFound {
                dataset_id: format!("Failed to load dataset metadata for {}: {}", dataset_id, e),
            })?;

        let files = dataset_files::table
            .filter(dataset_files::dataset_id.eq(dataset_id))
            .get_results::<DatasetFileModel>(&mut conn)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to load dataset files: {}", e),
            })?;

        let columns = dataset_columns::table
            .filter(dataset_columns::dataset_id.eq(dataset_id))
            .get_results::<DatasetColumnModel>(&mut conn)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to load dataset columns: {}", e),
            })?;

        let stats = dataset_statistics::table
            .filter(dataset_statistics::dataset_id.eq(dataset_id))
            .get_results::<DatasetStatisticModel>(&mut conn)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to load dataset statistics: {}", e),
            })?;

        let format = match dataset.format.as_str() {
            "csv" => DataFormat::Csv,
            "parquet" => DataFormat::Parquet,
            _ => DataFormat::Csv,
        };

        let files_vec: Vec<DatasetFile> = files.into_iter().map(|f| f.into()).collect();
        let columns_vec: Vec<ColumnMetadata> = columns.into_iter().map(|c| c.into()).collect();
        let statistics: HashMap<String, String> = stats
            .into_iter()
            .map(|s| (s.stat_key, s.stat_value))
            .collect();

        Ok(DatasetMetadataFile {
            id: dataset.id,
            uuid: dataset.uuid,
            name: dataset.name,
            description: dataset.description,
            format,
            size_bytes: dataset.size_bytes,
            row_count: dataset.row_count,
            tags: dataset.tags,
            created_at: dataset.created_at,
            updated_at: dataset.updated_at,
            dataset_path: dataset.dataset_path,
            files: files_vec,
            columns: columns_vec,
            statistics,
        })
    }
}

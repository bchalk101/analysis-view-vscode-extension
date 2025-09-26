use diesel::prelude::*;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use std::collections::HashMap;

use crate::schema::{datasets, dataset_files, dataset_columns, dataset_statistics};
use crate::catalog::{DataFormat, CatalogDatasetEntry, DatasetFile, ColumnMetadata};

#[derive(Queryable, Selectable, Identifiable, Debug, Clone)]
#[diesel(table_name = datasets)]
#[diesel(primary_key(id))]
pub struct Dataset {
    pub id: String,
    pub uuid: Uuid,
    pub name: String,
    pub description: String,
    pub format: String,
    pub size_bytes: i64,
    pub row_count: i32,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dataset_path: String,
    pub metadata_path: String,
}

#[derive(Insertable)]
#[diesel(table_name = datasets)]
pub struct NewDataset<'a> {
    pub id: &'a str,
    pub uuid: &'a Uuid,
    pub name: &'a str,
    pub description: &'a str,
    pub format: &'a str,
    pub size_bytes: i64,
    pub row_count: i32,
    pub tags: &'a Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dataset_path: &'a str,
    pub metadata_path: &'a str,
}

#[derive(Queryable, Selectable, Identifiable, Associations, Debug, Clone)]
#[diesel(table_name = dataset_files)]
#[diesel(belongs_to(Dataset, foreign_key = dataset_id))]
#[diesel(primary_key(dataset_id, filename))]
pub struct DatasetFileModel {
    pub dataset_id: String,
    pub filename: String,
    pub storage_path: String,
    pub size_bytes: i64,
    pub row_count: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = dataset_files)]
pub struct NewDatasetFile<'a> {
    pub dataset_id: &'a str,
    pub filename: &'a str,
    pub storage_path: &'a str,
    pub size_bytes: i64,
    pub row_count: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Queryable, Selectable, Identifiable, Associations, Debug, Clone)]
#[diesel(table_name = dataset_columns)]
#[diesel(belongs_to(Dataset, foreign_key = dataset_id))]
#[diesel(primary_key(dataset_id, name))]
pub struct DatasetColumnModel {
    pub dataset_id: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub description: String,
    pub statistics: serde_json::Value,
}

#[derive(Insertable)]
#[diesel(table_name = dataset_columns)]
pub struct NewDatasetColumn<'a> {
    pub dataset_id: &'a str,
    pub name: &'a str,
    pub data_type: &'a str,
    pub nullable: bool,
    pub description: &'a str,
    pub statistics: &'a serde_json::Value,
}

#[derive(Queryable, Selectable, Identifiable, Associations, Debug, Clone)]
#[diesel(table_name = dataset_statistics)]
#[diesel(belongs_to(Dataset, foreign_key = dataset_id))]
#[diesel(primary_key(dataset_id, stat_key))]
pub struct DatasetStatisticModel {
    pub dataset_id: String,
    pub stat_key: String,
    pub stat_value: String,
}

#[derive(Insertable)]
#[diesel(table_name = dataset_statistics)]
pub struct NewDatasetStatistic<'a> {
    pub dataset_id: &'a str,
    pub stat_key: &'a str,
    pub stat_value: &'a str,
}

impl From<Dataset> for CatalogDatasetEntry {
    fn from(dataset: Dataset) -> Self {
        let format = match dataset.format.as_str() {
            "csv" => DataFormat::Csv,
            "parquet" => DataFormat::Parquet,
            _ => DataFormat::Csv,
        };

        CatalogDatasetEntry {
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
            metadata_path: dataset.metadata_path,
        }
    }
}

impl From<DatasetFileModel> for DatasetFile {
    fn from(file: DatasetFileModel) -> Self {
        DatasetFile {
            filename: file.filename,
            storage_path: file.storage_path,
            size_bytes: file.size_bytes,
            row_count: file.row_count,
            created_at: file.created_at,
        }
    }
}

impl From<DatasetColumnModel> for ColumnMetadata {
    fn from(column: DatasetColumnModel) -> Self {
        let statistics: HashMap<String, String> = serde_json::from_value(column.statistics)
            .unwrap_or_default();

        ColumnMetadata {
            name: column.name,
            data_type: column.data_type,
            nullable: column.nullable,
            description: column.description,
            statistics,
        }
    }
}
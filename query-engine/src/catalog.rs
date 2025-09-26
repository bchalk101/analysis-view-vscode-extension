use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DataFormat {
    #[serde(rename = "csv")]
    Csv,
    #[serde(rename = "parquet")]
    Parquet,
}

impl DataFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            DataFormat::Csv => "csv",
            DataFormat::Parquet => "parquet",
        }
    }
}

impl std::fmt::Display for DataFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetCatalog {
    pub version: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub datasets: HashMap<String, CatalogDatasetEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogDatasetEntry {
    pub id: String,
    pub uuid: Uuid,
    pub name: String,
    pub description: String,
    pub format: DataFormat,
    pub size_bytes: i64,
    pub row_count: i32,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dataset_path: String,
    pub metadata_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetFile {
    pub filename: String,
    pub storage_path: String,
    pub size_bytes: i64,
    pub row_count: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetMetadataFile {
    pub id: String,
    pub uuid: Uuid,
    pub name: String,
    pub description: String,
    pub format: DataFormat,
    pub size_bytes: i64,
    pub row_count: i32,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dataset_path: String,
    pub files: Vec<DatasetFile>,
    pub columns: Vec<ColumnMetadata>,
    pub statistics: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub description: String,
    pub statistics: HashMap<String, String>,
}
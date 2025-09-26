use std::collections::HashMap;

use crate::proto::analysis;

#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub description: String,
    pub statistics: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct QueryMetadata {
    pub arrow_schema: Vec<u8>,
    pub column_names: Vec<String>,
    pub estimated_rows: i32,
}

#[derive(Debug, Clone)]
pub struct QueryDataChunk {
    pub arrow_ipc_data: Vec<u8>,
    pub chunk_rows: i32,
    pub chunk_index: i32,
}

#[derive(Debug, Clone)]
pub struct QueryStreamResult {
    pub metadata: Option<QueryMetadata>,
    pub chunks: Vec<QueryDataChunk>,
}

impl From<ColumnInfo> for analysis::ColumnInfo {
    fn from(domain: ColumnInfo) -> Self {
        Self {
            name: domain.name,
            data_type: domain.data_type,
            nullable: domain.nullable,
            description: domain.description,
            statistics: domain.statistics,
        }
    }
}

impl From<QueryMetadata> for analysis::QueryMetadata {
    fn from(domain: QueryMetadata) -> Self {
        Self {
            arrow_schema: domain.arrow_schema,
            column_names: domain.column_names,
            estimated_rows: domain.estimated_rows,
        }
    }
}

impl From<QueryDataChunk> for analysis::QueryDataChunk {
    fn from(domain: QueryDataChunk) -> Self {
        Self {
            arrow_ipc_data: domain.arrow_ipc_data,
            chunk_rows: domain.chunk_rows,
            chunk_index: domain.chunk_index,
        }
    }
}

impl QueryStreamResult {
    pub fn into_proto_parts(
        self,
    ) -> (
        Option<analysis::QueryMetadata>,
        Vec<analysis::QueryDataChunk>,
    ) {
        let metadata = self.metadata.map(|m| m.into());
        let chunks = self.chunks.into_iter().map(|c| c.into()).collect();
        (metadata, chunks)
    }
}

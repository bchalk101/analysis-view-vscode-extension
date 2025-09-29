use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    tool, tool_handler, tool_router, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AnalysisError;
use crate::query_client::QueryEngineClient;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetMetadataRequest {
    /// The ID of the dataset
    pub dataset_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ExecuteQueryRequest {
    /// The ID of the dataset to query
    pub dataset_id: String,
    /// The SQL query to execute
    pub sql_query: String,
    /// Maximum number of rows to return (optional)
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct VsCodeDatasetQuery {
    /// List of datasets to query
    pub datasets: Vec<VsCodeDataset>,
    /// Maximum number of rows to return (optional)
    #[serde(default)]
    pub limit: Option<i32>,
    /// Whether to return only the result rows (optional)
    #[serde(default)]
    pub result_only: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct VsCodeDataset {
    /// Dataset name
    pub name: String,
    /// Dataset path
    pub path: String,
    /// SQL query to execute
    pub sql: String,
}

#[derive(Debug, Clone)]
pub struct AnalysisService {
    query_client: Arc<Mutex<QueryEngineClient>>,
    tool_router: ToolRouter<Self>,
}

impl AnalysisService {
    pub async fn new(query_engine_endpoint: String) -> Result<Self, AnalysisError> {
        let query_client = QueryEngineClient::new(query_engine_endpoint).await?;
        Ok(Self {
            query_client: Arc::new(Mutex::new(query_client)),
            tool_router: Self::tool_router(),
        })
    }
}

#[tool_router]
impl AnalysisService {
    /// List all available datasets
    #[tool(name = "list_datasets", description = "List all available datasets")]
    pub async fn list_datasets(&self) -> String {
        let mut client = self.query_client.lock().await;
        match client.list_datasets().await {
            Ok(datasets) => {
                serde_json::to_string_pretty(&datasets).unwrap_or_else(|_| "[]".to_string())
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    /// Get metadata for a specific dataset
    #[tool(
        name = "get_metadata",
        description = "Get metadata for a specific dataset"
    )]
    pub async fn get_metadata(&self, Parameters(params): Parameters<GetMetadataRequest>) -> String {
        let mut client = self.query_client.lock().await;
        match client.get_metadata(&params.dataset_id).await {
            Ok(metadata) => {
                serde_json::to_string_pretty(&metadata).unwrap_or_else(|_| "{}".to_string())
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    /// Execute a SQL query on a dataset
    #[tool(
        name = "execute_query",
        description = "Execute a SQL query on a dataset"
    )]
    pub async fn execute_query(
        &self,
        Parameters(params): Parameters<ExecuteQueryRequest>,
    ) -> String {
        let mut client = self.query_client.lock().await;
        match client
            .execute_query(&params.dataset_id, &params.sql_query, params.limit)
            .await
        {
            Ok(result) => {
                let response = serde_json::json!({
                    "rows": result.rows,
                    "column_names": result.column_names,
                    "total_rows": result.total_rows,
                    "execution_time_ms": result.execution_time_ms
                });
                serde_json::to_string_pretty(&response).unwrap_or_else(|_| "{}".to_string())
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    /// Query dataset for VS Code extension compatibility
    #[tool(
        name = "mcp_reader-servic_query_dataset",
        description = "Query dataset for VS Code extension compatibility"
    )]
    pub async fn vscode_query_dataset(
        &self,
        Parameters(params): Parameters<VsCodeDatasetQuery>,
    ) -> String {
        if params.datasets.is_empty() {
            return "Error: No datasets provided".to_string();
        }

        let dataset = &params.datasets[0];
        let mut client = self.query_client.lock().await;
        match client
            .execute_query(&dataset.path, &dataset.sql, params.limit)
            .await
        {
            Ok(result) => {
                if params.result_only.unwrap_or(false) {
                    serde_json::to_string_pretty(&result.rows).unwrap_or_else(|_| "[]".to_string())
                } else {
                    let response = serde_json::json!({
                        "rows": result.rows,
                        "column_names": result.column_names,
                        "total_rows": result.total_rows,
                        "execution_time_ms": result.execution_time_ms
                    });
                    serde_json::to_string_pretty(&response).unwrap_or_else(|_| "{}".to_string())
                }
            }
            Err(e) => format!("Error: {}", e),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AnalysisService {}

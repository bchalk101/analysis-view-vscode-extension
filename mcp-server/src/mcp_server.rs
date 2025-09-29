use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tracing::info;

use crate::error::AnalysisError;
use crate::query_client::QueryEngineClient;

pub struct McpServer {
    query_client: Arc<Mutex<QueryEngineClient>>,
}

// MCP protocol structures
#[derive(Debug, Serialize, Deserialize)]
pub struct McpRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpResponse {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

// MCP tool definitions
#[derive(Debug, Serialize, Deserialize)]
pub struct ListDatasetsParams {}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetMetadataParams {
    pub dataset_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecuteQueryParams {
    pub dataset_id: String,
    pub sql_query: String,
    #[serde(default)]
    pub limit: Option<i32>,
}

impl McpServer {
    pub async fn new(query_engine_endpoint: String) -> Result<Self, AnalysisError> {
        let query_client = QueryEngineClient::new(query_engine_endpoint).await?;
        Ok(Self {
            query_client: Arc::new(Mutex::new(query_client)),
        })
    }

    pub async fn start(&self, addr: SocketAddr) -> Result<(), AnalysisError> {
        info!("Starting MCP server on {}", addr);

        let app = Router::new()
            .route("/", post(handle_mcp_request))
            .route("/health", get(health_check))
            .route("/tools", get(list_tools))
            .layer(CorsLayer::permissive())
            .with_state(self.query_client.clone());

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

async fn handle_mcp_request(
    State(query_client): State<Arc<Mutex<QueryEngineClient>>>,
    Json(request): Json<McpRequest>,
) -> Json<McpResponse> {
    info!(
        "Received MCP request: {} (id: {:?})",
        request.method, request.id
    );

    let response = match request.method.as_str() {
        "initialize" => handle_initialize(request.id, request.params),
        "initialized" => handle_initialized(request.id),
        "ping" => handle_ping(request.id),
        "tools/list" => handle_tools_list(request.id),
        "tools/call" => handle_tool_call(query_client, request.id, request.params).await,
        _ => McpResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id,
            result: None,
            error: Some(McpError {
                code: -32601,
                message: format!("Method not found: {}", request.method),
                data: None,
            }),
        },
    };

    Json(response)
}

fn handle_initialize(
    id: Option<serde_json::Value>,
    _params: Option<serde_json::Value>,
) -> McpResponse {
    let capabilities = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "analysis-engine",
            "version": "0.1.0"
        }
    });

    McpResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(capabilities),
        error: None,
    }
}

fn handle_initialized(id: Option<serde_json::Value>) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(serde_json::json!({})),
        error: None,
    }
}

fn handle_ping(id: Option<serde_json::Value>) -> McpResponse {
    McpResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(serde_json::json!({})),
        error: None,
    }
}

fn handle_tools_list(id: Option<serde_json::Value>) -> McpResponse {
    let tools = serde_json::json!({
        "tools": [
            {
                "name": "list_datasets",
                "description": "List all available datasets",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "get_metadata",
                "description": "Get metadata for a specific dataset",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "dataset_id": {
                            "type": "string",
                            "description": "The ID of the dataset"
                        }
                    },
                    "required": ["dataset_id"]
                }
            },
            {
                "name": "execute_query",
                "description": "Execute a SQL query on a dataset",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "dataset_id": {
                            "type": "string",
                            "description": "The ID of the dataset to query"
                        },
                        "sql_query": {
                            "type": "string",
                            "description": "The SQL query to execute"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of rows to return (optional)",
                            "minimum": 1,
                            "maximum": 10000
                        }
                    },
                    "required": ["dataset_id", "sql_query"]
                }
            },
            {
                "name": "mcp_reader-servic_query_dataset",
                "description": "Query dataset for VS Code extension compatibility",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "datasets": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "path": {"type": "string"},
                                    "sql": {"type": "string"}
                                },
                                "required": ["name", "path", "sql"]
                            }
                        },
                        "limit": {"type": "integer"},
                        "result_only": {"type": "boolean"}
                    },
                    "required": ["datasets"]
                }
            }
        ]
    });

    McpResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(tools),
        error: None,
    }
}

async fn handle_tool_call(
    query_client: Arc<Mutex<QueryEngineClient>>,
    id: Option<serde_json::Value>,
    params: Option<serde_json::Value>,
) -> McpResponse {
    let params = match params {
        Some(p) => p,
        None => {
            return McpResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: None,
                error: Some(McpError {
                    code: -32602,
                    message: "Invalid params".to_string(),
                    data: None,
                }),
            };
        }
    };

    let tool_name = match params.get("name").and_then(|n| n.as_str()) {
        Some(name) => name,
        None => {
            return McpResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: None,
                error: Some(McpError {
                    code: -32602,
                    message: "Missing tool name".to_string(),
                    data: None,
                }),
            };
        }
    };

    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    let result = match tool_name {
        "list_datasets" => handle_list_datasets(query_client).await,
        "get_metadata" => handle_get_metadata(query_client, arguments).await,
        "execute_query" => handle_execute_query(query_client, arguments).await,
        "mcp_reader-servic_query_dataset" => {
            handle_vscode_query_dataset(query_client, arguments).await
        }
        _ => Err(AnalysisError::ConfigError {
            message: format!("Unknown tool: {}", tool_name),
        }),
    };

    match result {
        Ok(content) => McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(serde_json::json!({
                "content": [
                    {
                        "type": "text",
                        "text": content
                    }
                ]
            })),
            error: None,
        },
        Err(e) => McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(McpError {
                code: -32603,
                message: e.to_string(),
                data: None,
            }),
        },
    }
}

async fn handle_list_datasets(
    query_client: Arc<Mutex<QueryEngineClient>>,
) -> Result<String, AnalysisError> {
    let mut client = query_client.lock().await;
    let datasets = client.list_datasets().await?;
    let response = serde_json::to_string_pretty(&datasets)?;
    Ok(response)
}

async fn handle_get_metadata(
    query_client: Arc<Mutex<QueryEngineClient>>,
    arguments: serde_json::Value,
) -> Result<String, AnalysisError> {
    let params: GetMetadataParams =
        serde_json::from_value(arguments).map_err(|e| AnalysisError::ConfigError {
            message: format!("Invalid arguments for get_metadata: {}", e),
        })?;

    let mut client = query_client.lock().await;
    let metadata = client.get_metadata(&params.dataset_id).await?;
    let response = serde_json::to_string_pretty(&metadata)?;
    Ok(response)
}

async fn handle_execute_query(
    query_client: Arc<Mutex<QueryEngineClient>>,
    arguments: serde_json::Value,
) -> Result<String, AnalysisError> {
    let params: ExecuteQueryParams =
        serde_json::from_value(arguments).map_err(|e| AnalysisError::ConfigError {
            message: format!("Invalid arguments for execute_query: {}", e),
        })?;

    let mut client = query_client.lock().await;
    let result = client
        .execute_query(&params.dataset_id, &params.sql_query, params.limit)
        .await?;

    let response = serde_json::json!({
        "rows": result.rows,
        "column_names": result.column_names,
        "total_rows": result.total_rows,
        "execution_time_ms": result.execution_time_ms
    });

    Ok(serde_json::to_string_pretty(&response)?)
}

#[derive(Debug, Serialize, Deserialize)]
struct VsCodeDatasetQuery {
    datasets: Vec<VsCodeDataset>,
    #[serde(default)]
    limit: Option<i32>,
    #[serde(default)]
    result_only: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VsCodeDataset {
    name: String,
    path: String,
    sql: String,
}

async fn handle_vscode_query_dataset(
    query_client: Arc<Mutex<QueryEngineClient>>,
    arguments: serde_json::Value,
) -> Result<String, AnalysisError> {
    let params: VsCodeDatasetQuery =
        serde_json::from_value(arguments).map_err(|e| AnalysisError::ConfigError {
            message: format!(
                "Invalid arguments for mcp_reader-servic_query_dataset: {}",
                e
            ),
        })?;

    if params.datasets.is_empty() {
        return Err(AnalysisError::ConfigError {
            message: "No datasets provided".to_string(),
        });
    }

    let dataset = &params.datasets[0];
    let mut client = query_client.lock().await;
    let result = client
        .execute_query(&dataset.path, &dataset.sql, params.limit)
        .await?;

    if params.result_only.unwrap_or(false) {
        Ok(serde_json::to_string_pretty(&result.rows)?)
    } else {
        let response = serde_json::json!({
            "rows": result.rows,
            "column_names": result.column_names,
            "total_rows": result.total_rows,
            "execution_time_ms": result.execution_time_ms
        });
        Ok(serde_json::to_string_pretty(&response)?)
    }
}

async fn health_check(
    State(query_client): State<Arc<Mutex<QueryEngineClient>>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut client = query_client.lock().await;
    match client.health_check().await {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "healthy",
            "version": "0.1.0",
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn list_tools() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "tools": [
            {
                "name": "list_datasets",
                "description": "List all available datasets",
                "parameters": {}
            },
            {
                "name": "get_metadata",
                "description": "Get metadata for a specific dataset",
                "parameters": {
                    "dataset_id": "string"
                }
            },
            {
                "name": "execute_query",
                "description": "Execute a SQL query on a dataset",
                "parameters": {
                    "dataset_id": "string",
                    "sql_query": "string",
                    "limit": "number (optional)"
                }
            }
        ]
    }))
}

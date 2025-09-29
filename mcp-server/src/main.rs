use rmcp::ServiceExt;
use tokio::io::{stdin, stdout};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod proto {
    pub mod analysis {
        tonic::include_proto!("analysis");
    }
}

mod error;
mod mcp_server;
mod query_client;

use mcp_server::AnalysisService;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mcp_server=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting MCP Server v0.1.0");

    let query_engine_endpoint = std::env::var("QUERY_ENGINE_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:50051".to_string());

    info!("Configuration loaded:");
    info!("  Query Engine Endpoint: {}", query_engine_endpoint);

    let transport = (stdin(), stdout());
    let service = AnalysisService::new(query_engine_endpoint).await?;

    info!("MCP server initialized successfully");

    let server = service.serve(transport).await?;

    info!("MCP server started successfully");

    server.waiting().await?;

    info!("MCP Server shutdown complete");
    Ok(())
}

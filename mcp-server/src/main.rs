use std::net::SocketAddr;
use tokio::signal;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod proto {
    pub mod analysis {
        tonic::include_proto!("analysis");
    }
}

mod error;
mod mcp_server;
mod query_client;

use mcp_server::McpServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mcp_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting MCP Server v0.1.0");

    let mcp_port: u16 = std::env::var("MCP_PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("Invalid MCP_PORT");

    let query_engine_endpoint = std::env::var("QUERY_ENGINE_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:50051".to_string());

    info!("Configuration loaded:");
    info!("  MCP Port: {}", mcp_port);
    info!("  Query Engine Endpoint: {}", query_engine_endpoint);

    let mcp_server = McpServer::new(query_engine_endpoint).await?;
    info!("MCP server initialized successfully");

    let mcp_addr: SocketAddr = ([0, 0, 0, 0], mcp_port).into();
    let mcp_handle = tokio::spawn(async move {
        if let Err(e) = mcp_server.start(mcp_addr).await {
            error!("MCP server error: {}", e);
        }
    });

    info!("MCP server started successfully");
    info!("MCP server listening on http://{}", mcp_addr);

    match signal::ctrl_c().await {
        Ok(()) => {
            info!("Received shutdown signal, gracefully shutting down...");
        }
        Err(err) => {
            error!("Unable to listen for shutdown signal: {}", err);
        }
    }

    mcp_handle.abort();

    info!("MCP Server shutdown complete");
    Ok(())
}

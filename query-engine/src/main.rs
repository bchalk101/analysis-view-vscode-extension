use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod proto {
    pub mod analysis {
        tonic::include_proto!("analysis");
    }
}

mod catalog;
mod database;
mod datafusion_engine;
mod dataset_manager;
mod domain;
mod engine;
mod error;
mod grpc_server;
mod models;
mod schema;
mod storage;

use engine::AnalysisEngine;
use grpc_server::GrpcServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "query_engine_service=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Query Engine Service v0.1.0");

    let grpc_port: u16 = std::env::var("GRPC_PORT")
        .unwrap_or_else(|_| "50051".to_string())
        .parse()
        .expect("Invalid GRPC_PORT");

    let bucket_name =
        std::env::var("GCS_BUCKET_NAME").expect("GCS_BUCKET_NAME environment variable is required");

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL environment variable is required");

    info!("Configuration loaded:");
    info!("  gRPC Port: {}", grpc_port);
    info!("  GCS Bucket: {}", bucket_name);
    info!(
        "  Database URL: {}",
        database_url.replace(
            &database_url[database_url.find("://").unwrap() + 3..database_url.rfind("@").unwrap()],
            "***"
        )
    );

    let engine = Arc::new(AnalysisEngine::new(bucket_name, database_url).await?);
    info!("Analysis engine initialized successfully");

    let grpc_server = GrpcServer::new(engine.clone());
    let grpc_addr: SocketAddr = ([0, 0, 0, 0], grpc_port).into();
    let grpc_handle = tokio::spawn(async move {
        if let Err(e) = grpc_server.start(grpc_addr).await {
            error!("gRPC server error: {}", e);
        }
    });

    info!("Query Engine Service started successfully");
    info!("gRPC server listening on {}", grpc_addr);

    match signal::ctrl_c().await {
        Ok(()) => {
            info!("Received shutdown signal, gracefully shutting down...");
        }
        Err(err) => {
            error!("Unable to listen for shutdown signal: {}", err);
        }
    }

    grpc_handle.abort();

    info!("Query Engine Service shutdown complete");
    Ok(())
}

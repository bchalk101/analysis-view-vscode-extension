use hyper::server::conn::http1;
use hyper::{body::Incoming, service::service_fn, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rmcp::ServiceExt;
use std::net::SocketAddr;
use tokio::net::TcpListener;
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

use mcp_server::AnalysisService;

async fn handle_request(
    req: Request<Incoming>,
    query_engine_endpoint: String,
) -> Result<Response<String>, hyper::Error> {
    info!(
        "Received HTTP request: {} {}",
        req.method(),
        req.uri().path()
    );

    tokio::spawn(async move {
        if let Ok(upgraded) = hyper::upgrade::on(req).await {
            info!("HTTP upgrade successful");
            let io = TokioIo::new(upgraded);

            match AnalysisService::new(query_engine_endpoint).await {
                Ok(service) => match service.serve(io).await {
                    Ok(server) => {
                        info!("MCP server session started");
                        if let Err(e) = server.waiting().await {
                            error!("Server error: {}", e);
                        }
                        info!("MCP server session ended");
                    }
                    Err(e) => error!("Failed to serve client: {}", e),
                },
                Err(e) => error!("Failed to create service: {}", e),
            }
        }
    });

    Ok(Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header(hyper::header::UPGRADE, "mcp")
        .header(hyper::header::CONNECTION, "upgrade")
        .body("Switching Protocols".to_string())
        .unwrap())
}

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

    let mcp_port: u16 = std::env::var("PORT")
        .or_else(|_| std::env::var("MCP_PORT"))
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("Invalid PORT");

    let query_engine_endpoint = std::env::var("QUERY_ENGINE_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:50051".to_string());

    info!("Configuration loaded:");
    info!("  MCP Port: {}", mcp_port);
    info!("  Query Engine Endpoint: {}", query_engine_endpoint);

    let addr: SocketAddr = ([0, 0, 0, 0], mcp_port).into();
    let tcp_listener = TcpListener::bind(addr).await?;

    info!("MCP server listening on {}", addr);

    while let Ok((stream, remote_addr)) = tcp_listener.accept().await {
        info!("New HTTP connection from {}", remote_addr);

        let query_engine_endpoint = query_engine_endpoint.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| {
                let endpoint = query_engine_endpoint.clone();
                async move { handle_request(req, endpoint).await }
            });

            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service)
                .with_upgrades()
                .await
            {
                error!("HTTP connection error for {}: {}", remote_addr, e);
            }
        });
    }

    Ok(())
}

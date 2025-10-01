use std::net::SocketAddr;
use std::sync::Arc;
use tonic::{transport::Server, Request, Response, Status};
use tracing::{error, info};

use crate::engine::AnalysisEngine;
use crate::error::AnalysisError;
use crate::proto::analysis::{
    analysis_service_server::{AnalysisService, AnalysisServiceServer},
    AddDatasetRequest, AddDatasetResponse, ExecuteQueryRequest, ExecuteQueryResponse,
    GetMetadataRequest, GetMetadataResponse, HealthCheckRequest, HealthCheckResponse,
    ListDatasetsRequest, ListDatasetsResponse, QueryComplete,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

pub struct GrpcServer {
    engine: Arc<AnalysisEngine>,
}

impl GrpcServer {
    pub fn new(engine: Arc<AnalysisEngine>) -> Self {
        Self { engine }
    }

    pub async fn start(&self, addr: SocketAddr) -> Result<(), AnalysisError> {
        info!("Starting gRPC server on {}", addr);

        let analysis_service = AnalysisServiceImpl {
            engine: self.engine.clone(),
        };

        Server::builder()
            .add_service(AnalysisServiceServer::new(analysis_service))
            .serve(addr)
            .await?;

        Ok(())
    }
}

struct AnalysisServiceImpl {
    engine: Arc<AnalysisEngine>,
}

#[tonic::async_trait]
impl AnalysisService for AnalysisServiceImpl {
    type ExecuteQueryStream = ReceiverStream<Result<ExecuteQueryResponse, Status>>;

    async fn list_datasets(
        &self,
        _request: Request<ListDatasetsRequest>,
    ) -> Result<Response<ListDatasetsResponse>, Status> {
        info!("gRPC: Received list_datasets request");

        let datasets = self.engine.list_datasets().await;
        let response = ListDatasetsResponse { datasets };

        info!("gRPC: Returning {} datasets", response.datasets.len());
        Ok(Response::new(response))
    }

    async fn get_metadata(
        &self,
        request: Request<GetMetadataRequest>,
    ) -> Result<Response<GetMetadataResponse>, Status> {
        let req = request.into_inner();
        info!(
            "gRPC: Received get_metadata request for dataset '{}'",
            req.dataset_id
        );

        match self.engine.get_metadata(&req.dataset_id).await {
            Ok(metadata) => {
                info!("gRPC: Returning metadata for dataset '{}'", req.dataset_id);
                Ok(Response::new(GetMetadataResponse {
                    metadata: Some(metadata),
                }))
            }
            Err(e) => {
                error!(
                    "gRPC: Failed to get metadata for dataset '{}': {}",
                    req.dataset_id, e
                );
                Err(Status::from(e))
            }
        }
    }

    async fn execute_query(
        &self,
        request: Request<ExecuteQueryRequest>,
    ) -> Result<Response<ReceiverStream<Result<ExecuteQueryResponse, Status>>>, Status> {
        let req = request.into_inner();
        info!(
            "gRPC: Received execute_query request for dataset '{}' with query: {}",
            req.dataset_id, req.sql_query
        );

        let (tx, rx) = mpsc::channel(32);
        let engine = self.engine.clone();

        tokio::spawn(async move {
            let start_time = std::time::Instant::now();
            let limit = if req.limit > 0 { Some(req.limit) } else { None };

            match engine
                .execute_query(&req.dataset_id, &req.sql_query, limit)
                .await
            {
                Ok(stream) => {
                    let mut chunk_index = 0;
                    let mut total_rows = 0;

                    let (metadata, chunks) = stream.into_proto_parts();

                    if let Some(metadata) = metadata {
                        let response = ExecuteQueryResponse {
                            response_type: Some(crate::proto::analysis::execute_query_response::ResponseType::Metadata(metadata)),
                        };
                        if tx.send(Ok(response)).await.is_err() {
                            return;
                        }
                    }

                    for chunk in chunks {
                        total_rows += chunk.chunk_rows;
                        let response = ExecuteQueryResponse {
                            response_type: Some(crate::proto::analysis::execute_query_response::ResponseType::DataChunk(chunk)),
                        };
                        if tx.send(Ok(response)).await.is_err() {
                            return; // Client disconnected
                        }
                        chunk_index += 1;
                    }

                    // Send completion message
                    let execution_time = start_time.elapsed();
                    let complete = QueryComplete {
                        total_rows,
                        execution_time_ms: execution_time.as_millis().to_string(),
                        success: true,
                        error_message: String::new(),
                    };
                    let response = ExecuteQueryResponse {
                        response_type: Some(
                            crate::proto::analysis::execute_query_response::ResponseType::Complete(
                                complete,
                            ),
                        ),
                    };
                    let _ = tx.send(Ok(response)).await;

                    info!(
                        "gRPC: Query completed. Sent {} chunks with {} total rows in {}ms",
                        chunk_index,
                        total_rows,
                        execution_time.as_millis()
                    );
                }
                Err(e) => {
                    error!("gRPC: Query failed: {}", e);
                    let complete = QueryComplete {
                        total_rows: 0,
                        execution_time_ms: start_time.elapsed().as_millis().to_string(),
                        success: false,
                        error_message: e.to_string(),
                    };
                    let response = ExecuteQueryResponse {
                        response_type: Some(
                            crate::proto::analysis::execute_query_response::ResponseType::Complete(
                                complete,
                            ),
                        ),
                    };
                    let _ = tx.send(Ok(response)).await;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn add_dataset(
        &self,
        request: Request<AddDatasetRequest>,
    ) -> Result<Response<AddDatasetResponse>, Status> {
        let req = request.into_inner();
        info!("gRPC: Received add_dataset request for '{}'", req.name);

        if req.name.is_empty() {
            return Ok(Response::new(AddDatasetResponse {
                success: false,
                dataset_id: String::new(),
                message: "Dataset name is required".to_string(),
                dataset: None,
            }));
        }

        if req.source_path.is_empty() {
            return Ok(Response::new(AddDatasetResponse {
                success: false,
                dataset_id: String::new(),
                message: "Source path is required".to_string(),
                dataset: None,
            }));
        }

        let description = if req.description.is_empty() {
            None
        } else {
            Some(req.description)
        };
        let tags = if req.tags.is_empty() {
            None
        } else {
            Some(req.tags)
        };
        let format = if req.format.is_empty() {
            None
        } else {
            Some(req.format)
        };

        match self
            .engine
            .add_dataset_from_external_path(
                req.name,
                req.source_path.clone(),
                description,
                tags,
                format,
            )
            .await
        {
            Ok(dataset_id) => {
                info!("Successfully added dataset '{}'", dataset_id);

                match self
                    .engine
                    .list_datasets()
                    .await
                    .into_iter()
                    .find(|d| d.id == dataset_id)
                {
                    Some(dataset) => Ok(Response::new(AddDatasetResponse {
                        success: true,
                        dataset_id: dataset_id.clone(),
                        message: format!("Dataset '{}' added successfully", dataset_id),
                        dataset: Some(dataset),
                    })),
                    None => Ok(Response::new(AddDatasetResponse {
                        success: true,
                        dataset_id: dataset_id.clone(),
                        message: format!("Dataset '{}' added successfully", dataset_id),
                        dataset: None,
                    })),
                }
            }
            Err(e) => {
                error!(
                    "gRPC: Failed to add dataset from '{}': {}",
                    req.source_path, e
                );
                Ok(Response::new(AddDatasetResponse {
                    success: false,
                    dataset_id: String::new(),
                    message: "Failed to add dataset. Please check the source path and try again."
                        .to_string(),
                    dataset: None,
                }))
            }
        }
    }

    async fn health_check(
        &self,
        _request: Request<HealthCheckRequest>,
    ) -> Result<Response<HealthCheckResponse>, Status> {
        info!("gRPC: Received health_check request");

        match self.engine.health_check().await {
            Ok(_) => {
                info!("gRPC: Health check passed");
                Ok(Response::new(HealthCheckResponse {
                    status: "healthy".to_string(),
                    version: "0.1.0".to_string(),
                }))
            }
            Err(e) => {
                error!("gRPC: Health check failed: {}", e);
                Err(Status::internal("Health check failed"))
            }
        }
    }
}

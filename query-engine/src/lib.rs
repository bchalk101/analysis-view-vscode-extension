pub mod proto {
    pub mod analysis {
        tonic::include_proto!("analysis");
    }
}

pub mod catalog;
pub mod database;
pub mod datafusion_engine;
pub mod dataset_manager;
pub mod domain;
pub mod engine;
pub mod error;
pub mod gcs_client;
pub mod grpc_server;
pub mod models;
pub mod schema;
pub mod storage;

pub use engine::AnalysisEngine;
pub use error::AnalysisError;
pub use grpc_server::GrpcServer;

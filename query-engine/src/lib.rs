pub mod proto {
    pub mod analysis {
        tonic::include_proto!("analysis");
    }
}

pub mod domain;
pub mod engine;
pub mod datafusion_engine;
pub mod grpc_server;
pub mod dataset_manager;
pub mod error;
pub mod catalog;
pub mod storage;
pub mod database;
pub mod schema;
pub mod models;

pub use engine::AnalysisEngine;
pub use grpc_server::GrpcServer;
pub use error::AnalysisError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AnalysisError {
    #[error("Dataset not found: {dataset_id}")]
    DatasetNotFound { dataset_id: String },

    #[error("Invalid SQL query: {message}")]
    InvalidSqlQuery { message: String },

    #[error("Query execution failed: {message}")]
    QueryExecutionFailed { message: String },

    #[error("IO error: {message}")]
    IoError { message: String },

    #[error("DataFusion error: {0}")]
    DataFusionError(#[from] datafusion::error::DataFusionError),

    #[error("Arrow error: {0}")]
    ArrowError(#[from] datafusion::arrow::error::ArrowError),

    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("HTTP client error: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("gRPC transport error: {0}")]
    GrpcError(#[from] tonic::transport::Error),

    #[error("gRPC status error: {0}")]
    GrpcStatusError(#[from] tonic::Status),

    #[error("Configuration error: {message}")]
    ConfigError { message: String },

    #[error("Internal server error: {message}")]
    InternalError { message: String },
}

impl From<std::io::Error> for AnalysisError {
    fn from(err: std::io::Error) -> Self {
        AnalysisError::IoError {
            message: err.to_string(),
        }
    }
}

impl From<diesel::result::Error> for AnalysisError {
    fn from(err: diesel::result::Error) -> Self {
        AnalysisError::ConfigError {
            message: format!("Database error: {}", err),
        }
    }
}

impl From<AnalysisError> for tonic::Status {
    fn from(err: AnalysisError) -> Self {
        match err {
            AnalysisError::DatasetNotFound { .. } => tonic::Status::not_found(err.to_string()),
            AnalysisError::InvalidSqlQuery { .. } => {
                tonic::Status::invalid_argument(err.to_string())
            }
            AnalysisError::QueryExecutionFailed { .. } => tonic::Status::internal(err.to_string()),
            AnalysisError::ConfigError { .. } => tonic::Status::invalid_argument(err.to_string()),
            _ => tonic::Status::internal(err.to_string()),
        }
    }
}

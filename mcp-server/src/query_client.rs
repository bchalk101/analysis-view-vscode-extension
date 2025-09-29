use arrow::array::Array;
use std::collections::HashMap;
use tonic::transport::Channel;
use tracing::{error, info};

use crate::error::AnalysisError;
use crate::proto::analysis::{
    analysis_service_client::AnalysisServiceClient, Dataset, DatasetMetadata, ExecuteQueryRequest,
    GetMetadataRequest, ListDatasetsRequest,
};

#[derive(Debug)]
pub struct QueryResult {
    pub rows: Vec<HashMap<String, String>>,
    pub column_names: Vec<String>,
    pub total_rows: usize,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone)]
pub struct QueryEngineClient {
    client: AnalysisServiceClient<Channel>,
}

impl QueryEngineClient {
    pub async fn new(endpoint: String) -> Result<Self, AnalysisError> {
        info!("Connecting to query engine at {}", endpoint);

        let client = AnalysisServiceClient::connect(endpoint)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to connect to query engine: {}", e),
            })?;

        info!("Successfully connected to query engine");

        Ok(Self { client })
    }

    pub async fn list_datasets(&mut self) -> Result<Vec<Dataset>, AnalysisError> {
        let request = tonic::Request::new(ListDatasetsRequest {});

        let response =
            self.client
                .list_datasets(request)
                .await
                .map_err(|e| AnalysisError::ConfigError {
                    message: format!("gRPC call failed: {}", e),
                })?;

        Ok(response.into_inner().datasets)
    }

    pub async fn get_metadata(
        &mut self,
        dataset_id: &str,
    ) -> Result<DatasetMetadata, AnalysisError> {
        let request = tonic::Request::new(GetMetadataRequest {
            dataset_id: dataset_id.to_string(),
        });

        let response =
            self.client
                .get_metadata(request)
                .await
                .map_err(|e| AnalysisError::ConfigError {
                    message: format!("gRPC call failed: {}", e),
                })?;

        response
            .into_inner()
            .metadata
            .ok_or_else(|| AnalysisError::DatasetNotFound {
                dataset_id: dataset_id.to_string(),
            })
    }

    pub async fn execute_query(
        &mut self,
        dataset_id: &str,
        sql_query: &str,
        limit: Option<i32>,
    ) -> Result<QueryResult, AnalysisError> {
        let request = tonic::Request::new(ExecuteQueryRequest {
            dataset_id: dataset_id.to_string(),
            sql_query: sql_query.to_string(),
            limit: limit.unwrap_or(1000),
        });

        let mut stream = self
            .client
            .execute_query(request)
            .await
            .map_err(|e| AnalysisError::ConfigError {
                message: format!("gRPC streaming call failed: {}", e),
            })?
            .into_inner();

        let mut all_rows = Vec::new();
        let mut column_names = Vec::new();
        let mut total_execution_time = 0u64;

        while let Some(response) =
            stream
                .message()
                .await
                .map_err(|e| AnalysisError::QueryExecutionFailed {
                    message: format!("Stream error: {}", e),
                })?
        {
            match response.response_type {
                Some(crate::proto::analysis::execute_query_response::ResponseType::Metadata(
                    metadata,
                )) => {
                    column_names = metadata.column_names;
                    info!("Received metadata with {} columns", column_names.len());
                }
                Some(crate::proto::analysis::execute_query_response::ResponseType::DataChunk(
                    chunk,
                )) => {
                    let chunk_rows =
                        self.convert_arrow_ipc_to_rows(&chunk.arrow_ipc_data, &column_names)?;
                    all_rows.extend(chunk_rows);
                    info!("Processed chunk with {} rows", chunk.chunk_rows);
                }
                Some(crate::proto::analysis::execute_query_response::ResponseType::Complete(
                    complete,
                )) => {
                    if let Ok(time_ms) = complete.execution_time_ms.parse::<u64>() {
                        total_execution_time = time_ms;
                    }
                    info!("Query completed in {}ms", total_execution_time);
                    break;
                }
                None => {
                    error!("Received empty response content");
                }
            }
        }

        let total_rows = all_rows.len();
        Ok(QueryResult {
            rows: all_rows,
            column_names,
            total_rows,
            execution_time_ms: total_execution_time,
        })
    }

    fn convert_arrow_ipc_to_rows(
        &self,
        arrow_data: &[u8],
        column_names: &[String],
    ) -> Result<Vec<HashMap<String, String>>, AnalysisError> {
        use arrow::ipc::reader::StreamReader;
        use std::io::Cursor;

        info!(
            "Converting Arrow IPC data ({} bytes) to rows for {} columns",
            arrow_data.len(),
            column_names.len()
        );

        if arrow_data.is_empty() {
            return Ok(Vec::new());
        }

        let cursor = Cursor::new(arrow_data);
        let reader =
            StreamReader::try_new(cursor, None).map_err(|e| AnalysisError::ConfigError {
                message: format!("Failed to create Arrow IPC reader: {}", e),
            })?;

        let mut all_rows = Vec::new();

        for batch_result in reader {
            let batch = batch_result.map_err(|e| AnalysisError::QueryExecutionFailed {
                message: format!("Failed to read Arrow batch: {}", e),
            })?;

            let row_count = batch.num_rows();
            for row_idx in 0..row_count {
                let mut row = HashMap::new();

                for (col_idx, column_name) in column_names.iter().enumerate() {
                    if col_idx < batch.num_columns() {
                        let column = batch.column(col_idx);
                        let value = self.extract_arrow_value_as_string(column.as_ref(), row_idx);
                        row.insert(column_name.clone(), value);
                    }
                }

                all_rows.push(row);
            }
        }

        info!(
            "Successfully converted Arrow IPC data to {} rows",
            all_rows.len()
        );
        Ok(all_rows)
    }

    fn extract_arrow_value_as_string(&self, array: &dyn Array, index: usize) -> String {
        if array.is_null(index) {
            return "NULL".to_string();
        }

        use arrow::array::*;
        use arrow::datatypes::DataType;

        match array.data_type() {
            DataType::Boolean => {
                let array = array.as_any().downcast_ref::<BooleanArray>().unwrap();
                array.value(index).to_string()
            }
            DataType::Int8 => {
                let array = array.as_any().downcast_ref::<Int8Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Int16 => {
                let array = array.as_any().downcast_ref::<Int16Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Int32 => {
                let array = array.as_any().downcast_ref::<Int32Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Int64 => {
                let array = array.as_any().downcast_ref::<Int64Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::UInt8 => {
                let array = array.as_any().downcast_ref::<UInt8Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::UInt16 => {
                let array = array.as_any().downcast_ref::<UInt16Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::UInt32 => {
                let array = array.as_any().downcast_ref::<UInt32Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::UInt64 => {
                let array = array.as_any().downcast_ref::<UInt64Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Float32 => {
                let array = array.as_any().downcast_ref::<Float32Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Float64 => {
                let array = array.as_any().downcast_ref::<Float64Array>().unwrap();
                array.value(index).to_string()
            }
            DataType::Utf8 => {
                let array = array.as_any().downcast_ref::<StringArray>().unwrap();
                array.value(index).to_string()
            }
            DataType::LargeUtf8 => {
                let array = array.as_any().downcast_ref::<LargeStringArray>().unwrap();
                array.value(index).to_string()
            }
            DataType::Date32 => {
                let array = array.as_any().downcast_ref::<Date32Array>().unwrap();
                let days = array.value(index);
                let date = chrono::NaiveDate::from_num_days_from_ce_opt(days + 719163);
                date.map(|d| d.to_string())
                    .unwrap_or_else(|| "Invalid Date".to_string())
            }
            DataType::Date64 => {
                let array = array.as_any().downcast_ref::<Date64Array>().unwrap();
                let millis = array.value(index);
                let datetime = chrono::DateTime::from_timestamp_millis(millis);
                datetime
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "Invalid Date".to_string())
            }
            DataType::Timestamp(unit, _) => {
                use arrow::datatypes::TimeUnit;
                let array = array
                    .as_any()
                    .downcast_ref::<TimestampNanosecondArray>()
                    .unwrap();
                let nanos = array.value(index);
                let seconds = match unit {
                    TimeUnit::Second => nanos,
                    TimeUnit::Millisecond => nanos / 1_000_000,
                    TimeUnit::Microsecond => nanos / 1_000,
                    TimeUnit::Nanosecond => nanos / 1_000_000_000,
                };
                let datetime = chrono::DateTime::from_timestamp(seconds, 0);
                datetime
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| "Invalid Timestamp".to_string())
            }
            _ => {
                format!("{:?}", array.slice(index, 1))
            }
        }
    }

    pub async fn _health_check(&mut self) -> Result<(), AnalysisError> {
        let _ = self.list_datasets().await?;
        Ok(())
    }
}

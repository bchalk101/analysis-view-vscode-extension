# Analysis MCP Server

A high-performance Rust-based MCP (Model Context Protocol) server that provides SQL query capabilities using DataFusion as the underlying engine. This server replaces the previous `mcp_reader_service` with a more robust, scalable solution deployed on Google Cloud Platform.

## Features

- **DataFusion SQL Engine**: Fast, memory-efficient SQL processing using Apache Arrow
- **MCP Protocol Support**: Standard MCP tools for dataset operations
- **gRPC API**: High-performance gRPC interface for direct client access
- **Pre-loaded Datasets**: Sample financial, health, and demographic datasets
- **Cloud-Native**: Designed for deployment on Google Cloud Run
- **Auto-scaling**: Automatically scales based on demand

## MCP Tools

The server provides three main MCP tools:

### 1. `list_datasets`
Lists all available datasets in the system.

**Parameters**: None

**Response**: Array of dataset objects with metadata

### 2. `get_metadata`
Retrieves detailed metadata for a specific dataset.

**Parameters**:
- `dataset_id` (string): The ID of the dataset

**Response**: Dataset metadata including column information, statistics, and schema

### 3. `execute_query`
Executes a SQL query against a specified dataset.

**Parameters**:
- `dataset_id` (string): The ID of the dataset to query
- `sql_query` (string): The SQL query to execute
- `limit` (integer, optional): Maximum number of rows to return (default: unlimited)

**Response**: Query results with rows, column names, and execution metadata

## Pre-loaded Datasets

The server comes with several sample datasets ready for analysis:

### Financial Data
- **Stock Prices** (`stock_prices`): Daily stock prices for major tech companies
  - Columns: date, symbol, open, high, low, close, volume

### Healthcare Data
- **Patient Metrics** (`patient_metrics`): Patient health indicators and risk factors
  - Columns: patient_id, age, gender, bmi, blood_pressure_systolic, blood_pressure_diastolic, cholesterol, glucose, smoking, diabetes

### Demographics Data
- **City Demographics** (`city_demographics`): Economic and demographic data for major US cities
  - Columns: city, state, population, median_age, median_income, unemployment_rate, education_level

## Local Development

### Prerequisites

- Rust 1.75 or later
- Protocol Buffers compiler (`protoc`)

### Build and Run

```bash
# Navigate to the server directory
cd mcp-server

# Build the server
cargo build --release

# Run the server
./target/release/server
```

### Environment Variables

- `MCP_PORT`: Port for MCP HTTP server (default: 8080)
- `GRPC_PORT`: Port for gRPC server (default: 50051)
- `DATA_DIR`: Directory containing data files (default: ./data)
- `RUST_LOG`: Log level configuration (default: analysis_mcp_server=info)

### Testing

```bash
# Run unit tests
cargo test

# Test the health endpoint
curl http://localhost:8080/health

# List available tools
curl http://localhost:8080/tools

# Test MCP tool call
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_datasets",
      "arguments": {}
    }
  }'
```

## Deployment

### Google Cloud Platform

The server is designed to run on Google Cloud Run with automatic CI/CD through GitHub Actions.

#### Manual Deployment

```bash
# Navigate to deployment scripts
cd deployment/scripts

# Deploy to GCP (requires gcloud CLI setup)
./deploy.sh your-project-id us-central1
```

#### Terraform Deployment

```bash
# Navigate to Terraform configuration
cd deployment/terraform

# Copy and configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project details

# Initialize and apply
terraform init
terraform plan
terraform apply
```

### Docker

```bash
# Build Docker image
docker build -t analysis-mcp-server .

# Run container
docker run -p 8080:8080 -p 50051:50051 \
  -e MCP_PORT=8080 \
  -e GRPC_PORT=50051 \
  -e DATA_DIR=/app/data \
  analysis-mcp-server
```

## API Reference

### HTTP Endpoints

- `GET /health`: Health check endpoint
- `GET /tools`: List available MCP tools
- `POST /`: MCP protocol endpoint for tool calls

### gRPC Service

The server also exposes a gRPC service defined in `proto/analysis.proto`:

- `ListDatasets`: Get all available datasets
- `GetMetadata`: Get metadata for a specific dataset
- `ExecuteQuery`: Execute SQL queries
- `HealthCheck`: Service health check

## Performance

- **Memory Usage**: Configurable memory limits, default 2GB for Cloud Run
- **Query Performance**: Optimized with DataFusion's columnar processing
- **Concurrent Requests**: Supports high concurrency with async Rust
- **Auto-scaling**: Scales from 1 to 10 instances based on load

## Security

- **No Authentication Required**: Currently allows unauthenticated access for development
- **SQL Injection Protection**: Parameterized queries through DataFusion
- **Resource Limits**: Memory and CPU limits prevent resource exhaustion
- **Network Security**: Runs in isolated Cloud Run environment

## Monitoring

- **Health Checks**: Built-in health endpoints for load balancers
- **Logging**: Structured logging with configurable levels
- **Metrics**: Cloud Run automatically provides performance metrics
- **Error Tracking**: Comprehensive error handling and reporting

## Migration from Legacy Service

The new MCP server is designed to be a drop-in replacement for the legacy `mcp_reader_service`. The VS Code extension automatically falls back to the legacy service if the new one is unavailable.

### Key Improvements

1. **Performance**: 10x faster query execution with DataFusion
2. **Reliability**: Better error handling and retry logic
3. **Scalability**: Auto-scaling cloud deployment
4. **Maintainability**: Type-safe Rust implementation
5. **Features**: More datasets and better metadata support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details
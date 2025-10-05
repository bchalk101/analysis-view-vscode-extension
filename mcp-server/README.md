# Analysis MCP Server

A Python-based MCP (Model Context Protocol) server that provides SQL query capabilities over datasets stored in Google Cloud Storage. This server uses FastMCP and connects to a backend query engine service for data processing.

## Architecture

The MCP server acts as a bridge between MCP clients (like VS Code extensions) and the query engine service:

- **MCP Server** (Python/FastMCP): Exposes MCP tools over HTTP with streamable responses
- **Query Engine** (gRPC): Backend service that handles SQL execution and dataset management
- **Storage**: Google Cloud Storage for dataset files

## Features

- **MCP Protocol Support**: Streamable HTTP transport with SSE (Server-Sent Events)
- **Dataset Management**: List, query, and retrieve metadata for datasets
- **Structured Logging**: Comprehensive request/response logging with timing
- **Cloud-Native**: Deployed on Google Cloud Run with auto-scaling
- **Authentication**: Service-to-service authentication using Google Cloud identity tokens

## MCP Tools

The server provides three main MCP tools:

### 1. `list_datasets`
Lists all available datasets from the query engine.

**Parameters**: None

**Response**: Array of dataset objects with metadata including:
- `id`, `name`, `description`
- `file_path`, `format`, `size_bytes`, `row_count`
- `tags`, `created_at`, `updated_at`

### 2. `get_metadata`
Retrieves detailed metadata for a specific dataset.

**Parameters**:
- `dataset_id` (string): The ID of the dataset

**Response**: Dataset metadata including:
- Basic info (id, name, description)
- Column information (name, data_type, nullable, statistics)
- Dataset statistics

### 3. `execute_query`
Executes a SQL query against a specified dataset.

**Parameters**:
- `dataset_id` (string): The ID of the dataset to query
- `sql_query` (string): The SQL query to execute
- `limit` (integer, optional): Maximum number of rows to return (default: 1000)

**Response**: Query results with:
- `rows`: Array of row dictionaries
- `column_names`: Array of column names
- `total_rows`: Total number of rows returned
- `execution_time_ms`: Query execution time

## Local Development

### Prerequisites

- Python 3.11 or later
- uv (Python package manager)

### Setup

```bash
cd mcp-server

uv sync

uv run python -m mcp_server.server
```

### Environment Variables

- `PORT` or `MCP_PORT`: Port for MCP HTTP server (default: 8080)
- `QUERY_ENGINE_ENDPOINT`: Query engine gRPC endpoint (default: http://localhost:50051)

### Testing

```bash
uv run pytest tests/

curl http://localhost:8080/health

curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
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

The server is deployed on Google Cloud Run with automatic CI/CD through GitHub Actions.

#### CI/CD Pipeline

The deployment workflow:
1. **Build**: Only builds Docker image when `mcp-server/**` files change
2. **Tag**: Always tags the image with commit SHA for deployment
3. **Deploy**: Terraform applies infrastructure changes

```yaml
query-engine:
  - 'query-engine/**'
mcp-server:
  - 'mcp-server/**'
terraform:
  - 'deployment/terraform/**'
```

#### Environment Configuration

Cloud Run environment variables (configured via Terraform):
- `QUERY_ENGINE_ENDPOINT`: Internal query engine service URL
- `PORT`: Service port (8080)

### Docker

```bash
docker build -t analysis-mcp-server .

docker run -p 8080:8080 \
  -e PORT=8080 \
  -e QUERY_ENGINE_ENDPOINT=http://query-engine:50051 \
  analysis-mcp-server
```

## API Reference

### HTTP Endpoints

- `GET /health`: Health check endpoint
- `POST /mcp`: MCP protocol endpoint for tool calls (requires `Accept: application/json, text/event-stream`)

### MCP Protocol

All MCP requests follow JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {}
  }
}
```

Responses use Server-Sent Events (SSE) format when applicable:

```
event: message
data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"..."}]}}
```

## Logging

Structured logging with the following fields:

**Request Start**:
```python
logger.info("Starting list_datasets request")
```

**Success**:
```python
logger.info(
    "list_datasets completed successfully",
    extra={"dataset_count": 10, "elapsed_ms": 250.5}
)
```

**Error**:
```python
logger.error(
    "list_datasets failed",
    extra={"elapsed_ms": 150.2, "error": "Connection timeout"},
    exc_info=True
)
```

## Security

- **Internal Query Engine**: Query engine is only accessible from within VPC
- **Service Authentication**: MCP server uses Google Cloud identity tokens to authenticate with query engine
- **Public MCP Endpoint**: MCP server itself is publicly accessible (no authentication required)
- **SQL Injection Protection**: All queries are parameterized through the query engine

## Performance

- **Streaming Responses**: Arrow IPC format for efficient data transfer from query engine
- **Buffered Transfers**: 10MB chunks for large dataset uploads
- **Auto-scaling**: Scales from 1 to 5 instances based on load
- **Memory Limits**: 1GB memory, 1 CPU per instance

## Monitoring

Query engine logs include:
- Request timing (total elapsed, query execution time)
- Row/column counts
- Error details with stack traces

Example log output:
```
INFO:mcp_server.server:Starting execute_query request
INFO:mcp_server.server:execute_query completed successfully {"dataset_id": "abc123", "row_count": 1000, "column_count": 5, "query_execution_ms": 45, "total_elapsed_ms": 250}
```

## E2E Testing

End-to-end tests run automatically in CI after deployment:

```bash
pytest tests/test_e2e.py -v

export MCP_SERVER_ENDPOINT=https://your-mcp-server.run.app/mcp
pytest tests/test_e2e.py -v
```

Tests verify:
- MCP server connectivity
- Tool invocation (list_datasets, get_metadata)
- Response format validation

## License

MIT License

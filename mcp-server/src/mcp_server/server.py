import json
import logging
import os
import time

from fastmcp import FastMCP
from pydantic import BaseModel

from .query_client import QueryEngineClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
query_engine_endpoint = os.getenv("QUERY_ENGINE_ENDPOINT", "http://localhost:50051")


class GetMetadataRequest(BaseModel):
    dataset_id: str


class ExecuteQueryRequest(BaseModel):
    dataset_id: str
    sql_query: str
    limit: int | None = None


class VsCodeDataset(BaseModel):
    name: str
    path: str
    sql: str


class VsCodeDatasetQuery(BaseModel):
    datasets: list[VsCodeDataset]
    limit: int | None = None
    result_only: bool | None = None


class AnalysisService:
    def __init__(self, query_engine_endpoint: str):
        self.query_engine_endpoint = query_engine_endpoint
        self.query_client = QueryEngineClient(self.query_engine_endpoint)

    async def close(self) -> None:
        if self.query_client:
            await self.query_client.close()


mcp = FastMCP("Analysis MCP Server")
service = AnalysisService(query_engine_endpoint)


@mcp.prompt()
def agentic_analytics_instructions() -> str:
    """Instructions for AI agents performing data analysis and discovering insights"""
    return """# Agentic Analytics - Dataset Analysis Guide

You are an AI data analyst tasked with exploring datasets and uncovering interesting insights.
Your goal is to find meaningful patterns, trends, anomalies, and actionable insights from data.

## Your Mission

1. **Explore** - Understand the dataset structure and content
2. **Analyze** - Run queries to uncover patterns and trends
3. **Discover** - Find unexpected insights, correlations, and anomalies
4. **Communicate** - Present findings clearly with supporting data

## Available Tools

1. **list_datasets** - Lists all available datasets with metadata
2. **get_metadata** - Gets detailed schema, column types, and statistics
3. **execute_query** - Executes SQL queries to analyze data

## Analysis Workflow

### Step 1: Understand the Dataset

First, explore what datasets are available:
```
list_datasets()
```

Then get detailed metadata including columns, types, and statistics:
```
get_metadata(dataset_id="dataset-id-here")
```

Review the column names, data types, and statistics to understand what questions you can answer.

### Step 2: Form Hypotheses

Based on the metadata, identify interesting questions:
- Are there trends over time?
- What are the distributions of key metrics?
- Are there correlations between variables?
- What are the outliers or anomalies?
- What segments or clusters exist in the data?

### Step 3: Query and Analyze

**CRITICAL SQL Rule**: Use the dataset_id as the table name in your FROM clause, wrapped in quotes.

Example queries:
```sql
-- Get overview statistics
SELECT COUNT(*), AVG(column), MAX(column), MIN(column)
FROM "550e8400-e29b-41d4-a716-446655440000"

-- Find trends over time
SELECT date_column, COUNT(*), SUM(metric)
FROM "dataset-id-here"
GROUP BY date_column
ORDER BY date_column

-- Identify top performers
SELECT category, COUNT(*) as count
FROM "dataset-id-here"
GROUP BY category
ORDER BY count DESC
LIMIT 10

-- Find anomalies (values far from average)
SELECT * FROM "dataset-id-here"
WHERE metric > (SELECT AVG(metric) * 2 FROM "dataset-id-here")
```

### Step 4: Iterate and Deep Dive

When you find something interesting:
- Run follow-up queries to understand it deeper
- Look for related patterns
- Quantify the impact
- Compare across segments

## Best Practices

- **Start broad, then narrow**: Begin with aggregations, then drill into specifics
- **Look for outliers**: Anomalies often reveal the most interesting insights
- **Compare segments**: Break data down by categories, time periods, or other dimensions
- **Validate findings**: Run multiple queries to confirm patterns
- **Think like a business analyst**: Ask "So what?" and "Why does this matter?"

## Technical Notes

- **Table naming**: Always use `SELECT * FROM "dataset-id"` (with quotes)
- **Limit results**: Add `LIMIT` to exploratory queries to avoid overwhelming output
- **Use aggregations**: GROUP BY, COUNT, AVG, SUM are your friends
- **Multi-pod architecture**: First query on a dataset may take slightly longer

## Example Analysis Session

1. List datasets and pick one with interesting metrics
2. Get metadata to understand columns and statistics
3. Run initial queries to understand distributions
4. Identify interesting patterns or anomalies
5. Deep dive with targeted queries
6. Synthesize findings into clear insights
"""


@mcp.tool()
async def list_datasets() -> str:
    """List all available datasets with their IDs and metadata.
    Use the 'id' field as the table name in SQL queries."""
    start_time = time.time()
    try:
        logger.info("Starting list_datasets request")
        datasets = await service.query_client.list_datasets()
        datasets_dict = []
        for dataset in datasets:
            datasets_dict.append(
                {
                    "id": dataset.id,
                    "name": dataset.name,
                    "description": dataset.description,
                    "file_path": dataset.file_path,
                    "format": dataset.format,
                    "size_bytes": dataset.size_bytes,
                    "row_count": dataset.row_count,
                    "tags": list(dataset.tags),
                    "created_at": dataset.created_at,
                    "updated_at": dataset.updated_at,
                }
            )
        elapsed_ms = (time.time() - start_time) * 1000
        logger.info(
            "list_datasets completed successfully",
            extra={"dataset_count": len(datasets_dict), "elapsed_ms": elapsed_ms},
        )
        return json.dumps(datasets_dict, indent=2)
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "list_datasets failed", extra={"elapsed_ms": elapsed_ms, "error": str(e)}, exc_info=True
        )
        return json.dumps({"error": "Failed to retrieve datasets. Please try again later."})


@mcp.tool()
async def get_metadata(params: GetMetadataRequest) -> str:
    """Get metadata for a specific dataset"""
    start_time = time.time()
    try:
        logger.info("Starting get_metadata request", extra={"dataset_id": params.dataset_id})
        metadata = await service.query_client.get_metadata(params.dataset_id)
        if not metadata:
            elapsed_ms = (time.time() - start_time) * 1000
            logger.warning(
                "get_metadata dataset not found",
                extra={"dataset_id": params.dataset_id, "elapsed_ms": elapsed_ms},
            )
            return json.dumps({"error": f"Dataset not found: {params.dataset_id}"})

        metadata_dict = {
            "id": metadata.id,
            "name": metadata.name,
            "description": metadata.description,
            "row_count": metadata.row_count,
            "size_bytes": metadata.size_bytes,
            "format": metadata.format,
            "tags": list(metadata.tags),
            "created_at": metadata.created_at,
            "updated_at": metadata.updated_at,
            "columns": [
                {
                    "name": col.name,
                    "data_type": col.data_type,
                    "nullable": col.nullable,
                    "description": col.description,
                    "statistics": dict(col.statistics),
                }
                for col in metadata.columns
            ],
            "statistics": dict(metadata.statistics),
        }
        elapsed_ms = (time.time() - start_time) * 1000
        logger.info(
            "get_metadata completed successfully",
            extra={
                "dataset_id": params.dataset_id,
                "column_count": len(metadata.columns),
                "row_count": metadata.row_count,
                "elapsed_ms": elapsed_ms,
            },
        )
        return json.dumps(metadata_dict, indent=2)
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "get_metadata failed",
            extra={"dataset_id": params.dataset_id, "elapsed_ms": elapsed_ms, "error": str(e)},
            exc_info=True,
        )
        return json.dumps({"error": "Failed to retrieve dataset metadata. Please try again later."})


@mcp.tool()
async def execute_query(params: ExecuteQueryRequest) -> str:
    """Execute a SQL query on a dataset.
    IMPORTANT: Use the dataset_id as the table name in your FROM clause.
    Example: SELECT * FROM "dataset-id-here" LIMIT 10"""
    start_time = time.time()
    try:
        logger.info(
            "Starting execute_query request",
            extra={"dataset_id": params.dataset_id, "limit": params.limit},
        )
        result = await service.query_client.execute_query(
            params.dataset_id, params.sql_query, params.limit
        )

        response = {
            "rows": result.rows,
            "column_names": result.column_names,
            "total_rows": result.total_rows,
            "execution_time_ms": result.execution_time_ms,
        }
        elapsed_ms = (time.time() - start_time) * 1000
        logger.info(
            "execute_query completed successfully",
            extra={
                "dataset_id": params.dataset_id,
                "row_count": result.total_rows,
                "column_count": len(result.column_names),
                "query_execution_ms": result.execution_time_ms,
                "total_elapsed_ms": elapsed_ms,
            },
        )
        return json.dumps(response, indent=2)
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "execute_query failed",
            extra={"dataset_id": params.dataset_id, "elapsed_ms": elapsed_ms, "error": str(e)},
            exc_info=True,
        )
        return json.dumps(
            {"error": "Failed to execute query. Please check your SQL syntax and try again."}
        )


def run_server() -> None:
    port = int(os.getenv("PORT", os.getenv("MCP_PORT", "8080")))
    query_engine_endpoint = os.getenv("QUERY_ENGINE_ENDPOINT", "http://localhost:50051")

    logger.info("Starting MCP Server")
    logger.info("Configuration loaded:")
    logger.info(f"  MCP Port: {port}")
    logger.info(f"  Query Engine Endpoint: {query_engine_endpoint}")

    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=port,
        show_banner=False,
        stateless_http=True,
    )

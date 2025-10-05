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


@mcp.tool()
async def list_datasets() -> str:
    """List all available datasets"""
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
    """Execute a SQL query on a dataset"""
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

    logger.info("Starting MCP Server v0.1.0")
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

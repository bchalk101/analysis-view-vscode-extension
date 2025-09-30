import json
import logging
import os

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
    try:
        datasets = await service.query_client.list_datasets()
        datasets_dict = []
        for dataset in datasets:
            datasets_dict.append(
                {
                    "id": dataset.id,
                    "name": dataset.name,
                    "description": dataset.description,
                    "category": dataset.category,
                    "file_path": dataset.file_path,
                    "format": dataset.format,
                    "size_bytes": dataset.size_bytes,
                    "row_count": dataset.row_count,
                    "tags": list(dataset.tags),
                    "created_at": dataset.created_at,
                    "updated_at": dataset.updated_at,
                }
            )
        return json.dumps(datasets_dict, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_metadata(params: GetMetadataRequest) -> str:
    """Get metadata for a specific dataset"""
    try:
        metadata = await service.query_client.get_metadata(params.dataset_id)
        if not metadata:
            return f"Error: Dataset not found: {params.dataset_id}"

        metadata_dict = {
            "id": metadata.id,
            "name": metadata.name,
            "description": metadata.description,
            "category": metadata.category,
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
        return json.dumps(metadata_dict, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def execute_query(params: ExecuteQueryRequest) -> str:
    """Execute a SQL query on a dataset"""
    try:
        result = await service.query_client.execute_query(
            params.dataset_id, params.sql_query, params.limit
        )

        response = {
            "rows": result.rows,
            "column_names": result.column_names,
            "total_rows": result.total_rows,
            "execution_time_ms": result.execution_time_ms,
        }
        return json.dumps(response, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


def run_server() -> None:
    port = int(os.getenv("PORT", os.getenv("MCP_PORT", "8080")))
    query_engine_endpoint = os.getenv("QUERY_ENGINE_ENDPOINT", "http://localhost:50051")

    logger.info("Starting MCP Server v0.1.0")
    logger.info("Configuration loaded:")
    logger.info(f"  MCP Port: {port}")
    logger.info(f"  Query Engine Endpoint: {query_engine_endpoint}")

    mcp.run(transport="streamable-http", host="0.0.0.0", port=port, show_banner=False)

from unittest.mock import MagicMock, patch

import pytest

from src.mcp_server.server import mcp


def test_mcp_server_created():
    """Test that the MCP server is properly created"""
    assert mcp is not None
    assert mcp.name == "Analysis MCP Server"


@pytest.mark.asyncio
@patch("src.mcp_server.server.service")
async def test_basic_service_functionality(mock_service):
    """Test basic service functionality by mocking the service directly"""
    # Mock the query client
    mock_query_client = MagicMock()
    mock_service.query_client = mock_query_client

    # Test that we can create the service without errors
    from src.mcp_server.server import AnalysisService

    service = AnalysisService("http://test:50051")
    assert service.query_engine_endpoint == "http://test:50051"

    # Test that close method exists and can be called
    await service.close()


def test_request_models():
    """Test that our request models work correctly"""
    from src.mcp_server.server import ExecuteQueryRequest, GetMetadataRequest

    # Test GetMetadataRequest
    metadata_req = GetMetadataRequest(dataset_id="test-id")
    assert metadata_req.dataset_id == "test-id"

    # Test ExecuteQueryRequest
    query_req = ExecuteQueryRequest(
        dataset_id="test-dataset", sql_query="SELECT * FROM test", limit=100
    )
    assert query_req.dataset_id == "test-dataset"
    assert query_req.sql_query == "SELECT * FROM test"
    assert query_req.limit == 100

    # Test ExecuteQueryRequest with optional limit
    query_req_no_limit = ExecuteQueryRequest(
        dataset_id="test-dataset", sql_query="SELECT * FROM test"
    )
    assert query_req_no_limit.limit is None


def test_query_result():
    """Test QueryResult class"""
    from src.mcp_server.query_client import QueryResult

    result = QueryResult(
        rows=[{"col1": "value1", "col2": "value2"}],
        column_names=["col1", "col2"],
        total_rows=1,
        execution_time_ms=100,
    )

    assert len(result.rows) == 1
    assert result.column_names == ["col1", "col2"]
    assert result.total_rows == 1
    assert result.execution_time_ms == 100


@pytest.mark.asyncio
async def test_query_engine_client_initialization():
    """Test QueryEngineClient can be initialized"""
    from src.mcp_server.query_client import QueryEngineClient

    client = QueryEngineClient("http://test:50051")
    assert client.endpoint == "http://test:50051"

    # Test close method exists
    await client.close()

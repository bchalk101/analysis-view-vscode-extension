import pytest
import httpx
import json
import os

@pytest.mark.asyncio
async def test_mcp_server_flow():
    mcp_endpoint = os.getenv("MCP_SERVER_ENDPOINT", "http://localhost:8080/mcp")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        list_response = await client.post(
            mcp_endpoint,
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "list_datasets", "arguments": {}},
            },
        )

        assert list_response.status_code == 200

        response_text = list_response.text
        if "event: message" in response_text and "data: " in response_text:
            lines = response_text.split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("data: "):
                    json_data = line[6:]
                    result = json.loads(json_data)
                    break

        content = result["result"]["content"]
        datasets = json.loads(content[0]["text"])

        if len(datasets) == 0:
            pytest.skip("No datasets available to test get_metadata")

        dataset_id = datasets[0]["id"]

        metadata_response = await client.post(
            mcp_endpoint,
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "get_metadata",
                    "arguments": {"params": {"dataset_id": dataset_id}}
                },
            },
        )

        assert metadata_response.status_code == 200, (
            f"Expected 200, got {metadata_response.status_code}: {metadata_response.text}"
        )

        response_text = metadata_response.text
        if "event: message" in response_text and "data: " in response_text:
            lines = response_text.split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("data: "):
                    json_data = line[6:]
                    result = json.loads(json_data)
                    break

        assert "result" in result
        content = result["result"]["content"]
        assert len(content) > 0

        metadata = json.loads(content[0]["text"])
        assert isinstance(metadata, dict) or "error" not in metadata
        assert "columns" in metadata
        assert len(metadata["columns"]) > 0

        query_response = await client.post(
            mcp_endpoint,
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "execute_query",
                    "arguments": {
                        "params": {
                            "dataset_id": dataset_id,
                            "sql_query": f'SELECT * FROM "{dataset_id}" LIMIT 5',
                            "limit": 5
                        }
                    }
                },
            },
        )

        assert query_response.status_code == 200, (
            f"Expected 200, got {query_response.status_code}: {query_response.text}"
        )

        response_text = query_response.text
        if "event: message" in response_text and "data: " in response_text:
            lines = response_text.split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("data: "):
                    json_data = line[6:]
                    result = json.loads(json_data)
                    break

        assert "result" in result
        content = result["result"]["content"]
        assert len(content) > 0

        query_result = json.loads(content[0]["text"])
        assert "error" not in query_result or query_result.get("error") is None
        assert "rows" in query_result
        assert len(query_result["rows"]) > 0
        assert "column_names" in query_result
        assert len(query_result["column_names"]) > 0

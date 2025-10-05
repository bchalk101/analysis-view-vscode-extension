import pytest
import httpx
import json
import os


@pytest.mark.asyncio
async def test_mcp_server_list_datasets_tool():
    mcp_endpoint = os.getenv("MCP_SERVER_ENDPOINT", "http://localhost:8080/mcp")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        response = await client.post(
            mcp_endpoint,
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "list_datasets", "arguments": {}},
            },
        )

        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )

        response_text = response.text
        if "event: message" in response_text and "data: " in response_text:
            lines = response_text.split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("data: "):
                    json_data = line[6:]
                    result = json.loads(json_data)
                    break
        else:
            result = response.json()

        assert "result" in result

        content = result["result"]["content"]
        assert len(content) > 0

        datasets = json.loads(content[0]["text"])
        assert isinstance(datasets, list) or "error" not in datasets


@pytest.mark.asyncio
async def test_mcp_server_get_metadata_tool():
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
                    "arguments": {"dataset_id": dataset_id}
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

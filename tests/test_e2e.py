import pytest
import httpx
import json
import os


@pytest.mark.asyncio
async def test_mcp_server_list_datasets_tool():
    mcp_endpoint = os.getenv("MCP_SERVER_ENDPOINT", "http://localhost:8080/mcp")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            mcp_endpoint,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "list_datasets",
                    "arguments": {}
                }
            }
        )

        assert response.status_code == 200

        result = response.json()
        assert "result" in result

        content = result["result"]["content"]
        assert len(content) > 0

        datasets = json.loads(content[0]["text"])
        assert isinstance(datasets, list) or "error" not in datasets

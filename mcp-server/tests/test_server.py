from src.mcp_server.server import create_mcp_server


def test_create_mcp_server():
    mcp = create_mcp_server()
    assert mcp is not None
    assert mcp.name == "Analysis MCP Server"


def test_mcp_tools_exist():
    mcp = create_mcp_server()

    # Basic test - ensure server can be created without errors
    # Full MCP functionality would require async testing with gRPC mock
    assert mcp.name == "Analysis MCP Server"

## Code Style
- Only implement functions that are used and required for the current functionality
- Functions should be easily understandable
- When asked to change a feature, dont support backward compatibility
- Dont over implement, keep the paths simple, only implement a single solution for each problem, even if it isnt optimized for one of them
- When implementing a new feature, check if there is now code that should be deleted
- Dont add comments when writing code or scripts

## Testing
- All tests should follow BDD, with explicit Given, When and Then written into the tests
- Only add tests that validate real functionality - avoid adding tests that don't actually test the issue or behavior

## MCP Server (mcp-server directory)
- Deployed to GCP Cloud Run in production
- Acts as a lightweight proxy to a gRPC backend query engine
- Uses FastMCP library with streamable-http transport
- Run in stateful mode (do not use stateless_http=True) - FastMCP has known bugs with stateless mode causing ClosedResourceError on client disconnects
- Cloud Run supports long-lived HTTP/SSE connections, so stateful mode is appropriate
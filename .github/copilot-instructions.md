# Analysis View Playground - VS Code Extension

## Architecture Overview

This VS Code extension provides an interactive playground for SQL and JavaScript visualization development with AI assistance. It integrates GitHub Copilot with a Model Context Protocol (MCP) service for dataset exploration.

### Core Components

- **AnalysisViewPlaygroundProvider** (`src/AnalysisViewPlaygroundProvider.ts`): Main webview provider with dual-panel UI (configuration sidebar + execution panel)
- **CopilotIntegration** (`src/CopilotIntegration.ts`): Manages VS Code Language Model API calls with MCP tool integration
- **MCP Data Services**: External services for querying datasets via Model Context Protocol
- **ValidationService** (`src/ValidationService.ts`): Error reporting and performance monitoring utilities

### Key Data Flow

1. User describes visualization goal in webview
2. Extension calls VS Code LM API with MCP tools enabled
3. AI explores actual dataset using MCP reader service tools
4. AI generates SQL (targeting 'base' table) + JavaScript (Plotly.js)
5. Extension executes SQL via MCP service and renders visualization

## Development Workflows

### Build & Debug
```bash
npm run compile    # Build TypeScript
npm run watch      # Watch mode for development
F5                 # Launch Extension Development Host
```

### Testing MCP Integration
Use command "Test MCP Service Connection" to verify:
- MCP server accessibility
- VS Code LM API availability  
- Tool invocation capabilities

## Critical Patterns

### MCP Tool Integration
```typescript
// Enable MCP tools for dataset exploration
const options: vscode.LanguageModelChatRequestOptions = {
  justification: 'Generating code analysis with dataset exploration',
  tools: mcpTools,
  toolMode: vscode.LanguageModelChatToolMode.Auto
};
```

### SQL Query Pattern
All generated SQL must use table name 'base':
```sql
SELECT column1, COUNT(*) as count FROM base GROUP BY column1
```

### Retry Logic with Chat History
The extension implements intelligent retry on SQL/visualization failures by maintaining `chatHistory` and appending error context for iterative fixes (max 3 retries).


## Extension-Specific Conventions

### Error Handling
All errors go through `ErrorReportingService.logError()` with context tags for debugging.

### Chat Progress Tracking
The extension maintains detailed chat progress (`ChatProgressStep[]`) for debugging AI conversations, including tool calls and results.

### Configuration Export
Generated configurations are JSON-serializable for integration with web applications via clipboard export.

### Dual Webview Architecture
- Primary webview: Configuration interface (sidebar)
- Secondary webview: Visualization execution panel (opens on demand)

## Integration Points

### VS Code APIs
- `vscode.lm.selectChatModels()` - GitHub Copilot integration
- `vscode.lm.invokeTool()` - MCP service calls
- `webview.postMessage()` - UI communication

### External Dependencies
- **MCP Services**: Configurable services for dataset queries
- **Plotly.js**: Visualization library (loaded via CDN in webview)
- **Data Services**: Backend data sources accessed via MCP

### Application Integration
Export format is designed for integration with React and other web applications. See `integration-example.js` for usage patterns in web applications.

## Key Files for Understanding

- `src/extension.ts`: Extension activation, MCP registration, command handlers
- `src/AnalysisViewPlaygroundProvider.ts`: Main UI logic, webview HTML generation (lines 400-900)
- `src/CopilotIntegration.ts`: AI prompt engineering, MCP tool orchestration  
- `package.json`: Extension manifest with MCP server definition provider
- `TESTING.md`: Comprehensive testing procedures and debugging steps


## Coding Principles
- **Simplicity**: Keep code modular and focused on single responsibilities
- **Readability**: Use clear variable names, and consistent formatting
- **Comments**: Never ever comment code, all code should be self-explanatory

## UX Principles
- **Intuitive Design**: Ensure the UI is user-friendly and guides users through the analysis
- **Feedback Mechanisms**: Provide clear feedback on actions (e.g., loading states, error messages)
- **Minimalistic Design**: Avoid unnecessary UI clutter, focus on essential controls, UI and UX should channel VSCode CoPilot experience, small buttons, clear actions, and a clean layout
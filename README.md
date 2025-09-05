# Analysis View Playground - VSCode Extension

A VSCode extension that provides an interactive playground for developing SQL queries and custom JavaScript visualizations. This extension integrates with GitHub Copilot to help generate code and provides a seamless workflow for prototyping data visualizations before integrating into your main application.

## Features

- 📊 **Interactive Chart Configuration**: Configure chart types, titles, and settings through a user-friendly interface
- 🔍 **SQL Query Development**: Write and test SQL queries with Copilot assistance
- ⚙️ **Custom JavaScript Editor**: Create custom Plotly configurations with intelligent code completion
- ✨ **GitHub Copilot Integration**: Generate SQL and JavaScript code with AI assistance
- 📈 **Live Preview**: See your changes in real-time (simulated data)
- 📤 **Export Functionality**: Copy configurations to clipboard for use in your main application
- 💡 **AI Prompt Generator**: Create detailed prompts for AI assistants to help with complex visualizations

## Installation

1. Open this project in VSCode
2. Navigate to the extension directory:
   ```bash
   cd analysis-view-vscode-extension
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Press `F5` to launch the extension in a new Extension Development Host window

## Usage

### Opening the Playground

1. Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
2. Search for "Open Analysis View Playground"
3. Or click on the Analysis View Playground icon in the Activity Bar

### Working with SQL Queries

1. **Write SQL directly in the playground**: Use the SQL Query section to write your queries
2. **Generate with Copilot**: Click "✨ Generate with Copilot" to open a SQL file with context
   - Write comments describing what you want to query
   - Copilot will suggest SQL based on your comments
   - Copy the generated SQL back to the playground
3. **Execute queries**: Click "▶️ Execute Query" to test with sample data

### Creating Custom JavaScript

1. **Select "Custom JavaScript" chart type**
2. **Load template**: Click "📋 Load Template" for a starting point
3. **Generate with Copilot**: Click "✨ Generate with Copilot" to open a JS file with:
   - Plotly.js templates and examples
   - Data structure documentation
   - Context-aware code suggestions
4. **Available variables in your code**:
   - `data`: Array of row objects from your SQL query
   - `columnNames`: Array of column names
   - `chartType`: Selected chart type

### AI Prompt Generation

For complex visualizations, use the built-in prompt generator:

1. Click "💡 Create Prompt" in the Custom JavaScript section
2. Describe what you want to achieve
3. Choose whether to include SQL query suggestions
4. Copy the generated prompt to use with Claude, ChatGPT, or other AI assistants

### Exporting Your Work

1. **Copy Configuration**: Click "📋 Copy Configuration" to copy the complete setup to clipboard
2. **Save to File**: Save your configuration as a JSON file for later use

## Extension Architecture

### Key Components

- **AnalysisViewPlaygroundProvider**: Main webview provider that handles the UI
- **CopilotIntegration**: Manages GitHub Copilot interactions and code generation
- **extension.ts**: Entry point that registers commands and providers

### Commands

- `analysis-view-playground.openPlayground`: Opens the main playground interface
- `analysis-view-playground.generateSQLWithCopilot`: Opens SQL editor with Copilot
- `analysis-view-playground.generateJSWithCopilot`: Opens JavaScript editor with Copilot
- `analysis-view-playground.exportToMainApp`: Exports configuration to clipboard

## Integration with React Applications

This extension is designed to work with React applications that need data visualization components. The generated configurations can be directly imported into your React application:

```tsx
// Example of using exported configuration
const analysisViewConfig = {
  "name": "Sales Analysis",
  "title": "Sales by Region",
  "chartType": "bar",
  "sqlQuery": "SELECT region, SUM(sales) as total FROM sales_data GROUP BY region",
  "customPlotlyConfig": "// Generated JavaScript code..."
};

// Apply to your visualization component
updateVisualization(analysisViewConfig);
```

## Requirements

- **VSCode**: Version 1.74.0 or higher
- **GitHub Copilot**: Install the GitHub Copilot extension for AI-assisted code generation
- **Node.js**: For development and compilation

## Development

### Building the Extension

```bash
npm run compile
```

### Running in Development

1. Press `F5` in VSCode to launch the Extension Development Host
2. Make changes to the TypeScript files
3. Reload the Extension Development Host window to see changes

### Packaging

```bash
npm install -g vsce
vsce package
```

## Configuration

The extension works out of the box, but you can customize:

- **Chart Types**: Modify `ANALYSIS_VIEW_CHART_TYPES` in the webview HTML
- **Templates**: Update JavaScript templates in `CopilotIntegration.ts`
- **Sample Data**: Modify mock data in `AnalysisViewPlaygroundProvider.ts`

## Troubleshooting

### Copilot Not Working
- Ensure GitHub Copilot extension is installed and authenticated
- Check that you have an active Copilot subscription
- Restart VSCode if Copilot suggestions aren't appearing

### Extension Not Loading
- Check the Developer Console (`Help > Toggle Developer Tools`) for errors
- Ensure all dependencies are installed with `npm install`
- Try recompiling with `npm run compile`

### Preview Not Updating
- The preview currently uses mock data
- Actual chart rendering would require connecting to your data source
- Export your configuration and test in your main application

## MCP (Model Context Protocol) Integration

This extension supports MCP servers for data analysis. MCP allows you to connect to various data sources securely.

### Quick Setup
1. Install MCP server software for your data sources (PostgreSQL, MySQL, S3, etc.)
2. Configure MCP servers in VS Code settings under `analysisViewPlayground.mcpServers`
3. The extension will automatically detect and use available MCP tools

### Detailed Configuration
See [MCP_SETUP.md](MCP_SETUP.md) for complete setup instructions including:
- Installing MCP servers for different data sources
- Configuration examples for popular databases and services
- Creating custom MCP servers
- Security considerations and troubleshooting

### Example Configuration
```json
{
  "analysisViewPlayground.mcpServers": [
    {
      "name": "PostgreSQL Database",
      "command": "python",
      "args": ["-m", "mcp_server_postgres"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  ]
}
```

## Future Enhancements

- [ ] Real data connection for live previews
- [ ] Advanced Plotly configuration options
- [ ] Template sharing and community templates
- [ ] More MCP server integrations
- [ ] Chart performance optimization suggestions
- [ ] Automated testing for generated configurations

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup instructions
- Coding guidelines and standards
- Pull request process
- Testing requirements

## License

This project is open source under the MIT License. See [LICENSE](LICENSE) for details.

# Analysis View Playground - VSCode Extension

A VSCode extension that provides an interactive playground for developing SQL queries and custom JavaScript visualizations. This extension integrates with GitHub Copilot to help generate code and provides a seamless workflow for prototyping data visualizations before integrating into your main application.

## Features

- 🔍 **SQL Query Development**: Write and test SQL queries with Copilot assistance
- ⚙️ **Custom JavaScript Editor**: Create custom Plotly configurations with intelligent code completion
- ✨ **GitHub Copilot Integration**: Generate SQL and JavaScript code with AI assistance
- 📤 **Export Functionality**: Copy configurations to clipboard for use in your main application
- 💡 **AI Prompt Generator**: Create detailed prompts for AI assistants to help with complex visualizations

## Usage

### Opening the Playground

1. Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
2. Search for "Open Analysis View Playground"
3. Or click on the Analysis View Playground icon in the Activity Bar

### Working with SQL Queries

1. **Write SQL directly in the playground**: Use the SQL Query section to write your queries
2. **Generate with Copilot**: Click "Generate with Copilot" to open a SQL file with context
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

## MCP (Model Context Protocol) Integration

This extension supports MCP servers for data analysis. MCP allows you to connect to various data sources securely.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup instructions
- Coding guidelines and standards
- Pull request process
- Testing requirements

## License

This project is open source under the MIT License. See [LICENSE](LICENSE) for details.

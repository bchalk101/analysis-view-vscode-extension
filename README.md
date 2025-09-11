# Analysis View Playground - VSCode Extension

Transform your data into compelling stories with AI assistance. This VS Code extension helps you explore datasets, generate insights, and create beautiful visualizations - all without leaving your editor.

## What You Can Do

- 📊 **Generate Data Stories**: Describe what you want to explore and get a complete analysis with multiple charts and insights
- 🔍 **Write SQL Queries**: Get AI help writing and testing database queries
- 📈 **Create Custom Charts**: Build interactive visualizations with Plotly.js
- 🔌 **Connect to Data Sources**: Access databases and files through secure connections
- 📤 **Export Everything**: Share your analysis as HTML reports, JSON data, or PDF-ready documents
- 🚫 **Stay in Control**: Cancel AI generation anytime if it's not going where you want

## Getting Started

### Quick Start

1. **Open the Extension**: 
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Open Analysis View Playground" and press Enter
   - Or click the chart icon in the VS Code sidebar

2. **Point to Your Data**:
   - Enter the path to your data file (CSV, JSON, database, etc.)

3. **Describe What You Want**:
   - Tell the AI what you want to explore (e.g., "Show me sales patterns over time and identify the best performing products")

4. **Generate Your Story**:
   - Click "Generate Data Story" and watch as the AI creates multiple analysis steps with charts

5. **Explore and Export**:
   - Navigate through the generated insights
   - Export as HTML to share with others

### Sharing Your Work

- Export as HTML for interactive reports

### Tips for Better Results

- **Be Specific**: Instead of "analyze my data", try "compare monthly revenue by product category and highlight seasonal trends"
- **Mention Chart Types**: Ask for "bar charts showing..." or "time series plots of..."
- **Use Real Column Names**: If you know your data structure, mention actual column names
- **Start Simple**: Begin with basic exploration, then ask for deeper analysis

## Setup Requirements

### What You Need

- **VS Code**: Version 1.74.0 or newer
- **AI Model Access**: The extension works with Claude, GPT, or other AI models available in VS Code
- **Your Data**: CSV files, databases, or other data sources you want to analyze

### Optional: Connect to Databases

For advanced users who want to connect to databases or external data sources:
- Configure data connections through VS Code settings
- The extension supports secure data access protocols
- Use the "Test MCP Service Connection" command to verify connections

## Examples of What You Can Create

### Sales Analysis Story
Ask: *"Analyze quarterly sales performance and identify top products by region"*
- Get: Multi-step analysis with revenue trends, product rankings, regional comparisons, and actionable insights

### Customer Behavior Analysis  
Ask: *"Explore user engagement patterns and conversion funnels"*
- Get: User journey visualizations, drop-off analysis, and retention insights

### Financial Performance Dashboard
Ask: *"Show financial health metrics and compare against industry benchmarks"*  
- Get: KPI dashboards, trend analysis, and comparative charts

### Operational Efficiency Review
Ask: *"Analyze process performance and identify bottlenecks"*
- Get: Process flow charts, performance metrics, and improvement recommendations

## Troubleshooting

### Common Issues

**"No AI model available"**
- Make sure you have Claude Code or another AI extension installed in VS Code
- Check that your AI service is properly configured

**"Cannot read data file"**  
- Verify the file path is correct
- Ensure the file format is supported (CSV, JSON, etc.)
- Check file permissions

**"MCP connection failed"**
- This is optional - basic features work without MCP
- For database connections, verify your connection settings

### Getting Help

- Check the VS Code output panel for detailed error messages
- Use the "Test MCP Service Connection" command to diagnose connection issues
- Report issues on our GitHub repository

---

**Ready to turn your data into insights?** Install the extension and start exploring!

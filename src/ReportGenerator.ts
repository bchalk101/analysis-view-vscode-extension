import * as vscode from 'vscode';
import * as os from 'os';
import { AnalysisViewConfig, ChatProgressStep, CompleteReport, ExportFormat, StoryState } from "./types";
import { ErrorReportingService } from "./ValidationService";


export class ReportGenerator {

    public async exportCompleteReport(storyState: StoryState, chatProgress: ChatProgressStep[], format: ExportFormat, config: AnalysisViewConfig): Promise<void> {
        try {
            ErrorReportingService.logInfo(`Starting export with format: ${format}`, 'export');

            if (!storyState.currentStory && !config.description && !config.datasetPath) {
                vscode.window.showWarningMessage('No analysis content to export. Please generate a data story first.');
                return;
            }

            ErrorReportingService.logInfo('Generating complete report', 'export');
            const report = this._generateCompleteReport(storyState, chatProgress, format, config);

            let content: string;
            let fileExtension: string;

            ErrorReportingService.logInfo(`Processing format: ${format}`, 'export');
            switch (format) {
                case 'json':
                    ErrorReportingService.logInfo('Generating JSON content', 'export');
                    content = JSON.stringify(report, null, 2);
                    fileExtension = 'json';
                    break;
                case 'html':
                    ErrorReportingService.logInfo('Generating HTML content', 'export');
                    content = this._generateHTMLReport(report);
                    fileExtension = 'html';
                    break;
                case 'pdf-ready':
                    ErrorReportingService.logInfo('Generating PDF-ready content', 'export');
                    content = this._generatePDFReadyReport(report);
                    fileExtension = 'html';
                    break;
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }
            ErrorReportingService.logInfo(`Generated content length: ${content.length}`, 'export');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const filename = `analysis-report-${timestamp}.${fileExtension}`;

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const defaultPath = workspaceFolder ?
                vscode.Uri.joinPath(workspaceFolder, filename) :
                vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), filename);

            ErrorReportingService.logInfo(`Default save path: ${defaultPath.fsPath}`, 'export');

            const filterName = format === 'pdf-ready' ? 'HTML (PDF-Ready)' : format.toUpperCase() + ' Files';
            const uri = await vscode.window.showSaveDialog({
                defaultUri: defaultPath,
                filters: {
                    [filterName]: [fileExtension]
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                vscode.window.showInformationMessage(`Report exported successfully to ${uri.fsPath}`);

                const action = await vscode.window.showInformationMessage(
                    'Would you like to open the exported report?',
                    'Open'
                );

                if (action === 'Open') {
                    await vscode.env.openExternal(uri);
                }
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export report: ${error}`);
            ErrorReportingService.logError(error as Error, 'export-complete-report');
        }
    }


    private _generateCompleteReport(storyState: StoryState, chatProgress: ChatProgressStep[], format: ExportFormat, config: any): CompleteReport {
        return {
            metadata: {
                title: storyState.currentStory?.title || config.name || 'Analysis Report',
                description: storyState.currentStory?.description || config.description || 'Generated analysis report',
                exportedAt: new Date().toISOString(),
                exportFormat: format,
                generatedBy: 'Analysis View Playground v0.4.0'
            },
            configuration: {
                ...config,
                exportedAt: new Date().toISOString()
            },
            story: storyState.currentStory,
            chatProgress: chatProgress
        };
    }

    private _generatePDFReadyReport(report: CompleteReport): string {
        return this._generateHTMLReport(report).replace(
            '<style>',
            '<style>\n        @page { size: A4; margin: 1in; }\n        body { print-color-adjust: exact; }'
        );
    }

    private _generateHTMLReport(report: CompleteReport): string {
        const storySteps = report.story?.steps || [];
        const hasStory = storySteps.length > 0;

        return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${report.metadata.title}</title>
        <script src="https://cdn.plot.ly/plotly-3.0.2.min.js"></script>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 20px;
                background-color: #f8f9fa;
                color: #333;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 40px 30px;
                text-align: center;
            }
            .header h1 {
                margin: 0 0 10px 0;
                font-size: 2.5em;
                font-weight: 700;
            }
            .header p {
                margin: 0;
                opacity: 0.9;
                font-size: 1.1em;
            }
            .metadata {
                background: #f8f9fa;
                padding: 20px 30px;
                border-bottom: 1px solid #dee2e6;
            }
            .metadata-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
            }
            .metadata-item {
                display: flex;
                flex-direction: column;
            }
            .metadata-label {
                font-weight: 600;
                color: #6c757d;
                font-size: 0.9em;
                margin-bottom: 5px;
            }
            .metadata-value {
                color: #333;
            }
            .content {
                padding: 30px;
            }
            .section {
                margin-bottom: 40px;
            }
            .section h2 {
                color: #495057;
                border-bottom: 2px solid #e9ecef;
                padding-bottom: 10px;
                margin-bottom: 20px;
            }
            .story-step {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 25px;
                margin-bottom: 25px;
                border-left: 4px solid #667eea;
            }
            .step-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            .step-title {
                font-size: 1.3em;
                font-weight: 600;
                color: #333;
                margin: 0;
            }
            .step-type {
                background: #667eea;
                color: white;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.8em;
                text-transform: uppercase;
                font-weight: 600;
            }
            .step-description {
                margin-bottom: 15px;
                color: #6c757d;
            }
            .insight-box {
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                color: white;
                padding: 15px;
                border-radius: 6px;
                margin-bottom: 20px;
            }
            .insight-box strong {
                display: block;
                margin-bottom: 8px;
                font-size: 1.1em;
            }
            .visualization-container {
                min-height: 400px;
                background: white;
                border: 1px solid #dee2e6;
                border-radius: 6px;
                padding: 10px;
                margin-top: 15px;
                width: 100%;
                overflow: auto;
                resize: both;
            }
            .code-block {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 4px;
                padding: 15px;
                margin: 10px 0;
                font-family: 'Monaco', 'Consolas', monospace;
                font-size: 0.9em;
                overflow-x: auto;
            }
            .code-label {
                font-weight: 600;
                color: #495057;
                margin-bottom: 10px;
                display: block;
            }
            .config-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
            }
            .config-item {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 6px;
            }
            .config-item h3 {
                margin: 0 0 10px 0;
                color: #495057;
            }
            .footer {
                background: #f8f9fa;
                padding: 20px 30px;
                text-align: center;
                color: #6c757d;
                font-size: 0.9em;
                border-top: 1px solid #dee2e6;
            }
            @media print {
                body { background: white; }
                .container { box-shadow: none; }
                .story-step { break-inside: avoid; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header class="header">
                <h1>${report.metadata.title}</h1>
                <p>${report.metadata.description}</p>
            </header>
    
            <div class="metadata">
                <div class="metadata-grid">
                    <div class="metadata-item">
                        <span class="metadata-label">Generated</span>
                        <span class="metadata-value">${new Date(report.metadata.exportedAt).toLocaleString()}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Dataset</span>
                        <span class="metadata-value">${report.configuration.datasetPath || 'Not specified'}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Export Format</span>
                        <span class="metadata-value">${report.metadata.exportFormat.toUpperCase()}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Generated By</span>
                        <span class="metadata-value">${report.metadata.generatedBy}</span>
                    </div>
                </div>
            </div>
    
            <div class="content">
                ${hasStory ? `
                <section class="section">
                    <h2>📊 Data Story</h2>
                    ${storySteps.map((step, _index) => `
                    <div class="story-step">
                        <div class="step-header">
                            <h3 class="step-title">${step.title}</h3>
                            <span class="step-type">${step.visualizationType}</span>
                        </div>
                        <div class="step-description">${step.description}</div>
                        <div class="insight-box">
                            <strong>💡 Key Insight</strong>
                            ${step.insight}
                        </div>
                        
                        <span class="code-label">SQL Query:</span>
                        <div class="code-block">${step.sqlQuery}</div>
                        
                        <div class="visualization-container" id="viz-${step.id}"></div>
                        
                        <script>
                            (function() {
                                try {
                                    const container = document.getElementById('viz-${step.id}');
                                    ${step.jsCode.replace(/`/g, '\\`').replace(/\$\{/g, '\\$\\{')}

                                    // Enable responsive behavior for exported charts
                                    setTimeout(() => {
                                        const plotElement = document.getElementById('viz-${step.id}');
                                        if (plotElement && plotElement.data && window.Plotly) {
                                            // Make plot responsive
                                            Plotly.Plots.resize(plotElement);

                                            // Add ResizeObserver for automatic resizing
                                            if (window.ResizeObserver && !plotElement.resizeObserver) {
                                                const resizeObserver = new ResizeObserver(entries => {
                                                    Plotly.Plots.resize(plotElement);
                                                });
                                                resizeObserver.observe(plotElement);
                                                plotElement.resizeObserver = resizeObserver;
                                            }

                                            // Handle window resize events
                                            window.addEventListener('resize', () => {
                                                Plotly.Plots.resize(plotElement);
                                            });
                                        }
                                    }, 100);
                                } catch (error) {
                                    console.error('Visualization error for step ${step.title}:', error);
                                    document.getElementById('viz-${step.id}').innerHTML = '<div style="color: red; padding: 20px;">Visualization Error: ' + error.message + '</div>';
                                }
                            })();
                        </script>
                    </div>
                    `).join('')}
                </section>
                ` : ''}
    
                <section class="section">
                    <h2>⚙️ Configuration</h2>
                    <div class="config-grid">
                        <div class="config-item">
                            <h3>General</h3>
                            <p><strong>Name:</strong> ${report.configuration.name}</p>
                            <p><strong>Description:</strong> ${report.configuration.description || 'None'}</p>
                            <p><strong>Dataset Path:</strong> ${report.configuration.datasetPath}</p>
                        </div>
                        <div class="config-item">
                            <h3>Model Settings</h3>
                            <p><strong>Selected Model:</strong> ${report.configuration.selectedModel || 'Default'}</p>
                            <p><strong>MCP Server:</strong> ${report.configuration.selectedMcpServer || 'All available'}</p>
                        </div>
                    </div>
                    
                    ${report.configuration.sqlQuery ? `
                    <div style="margin-top: 20px;">
                        <span class="code-label">Generated SQL Query:</span>
                        <div class="code-block">${report.configuration.sqlQuery}</div>
                    </div>
                    ` : ''}
                    
                    ${report.configuration.customJS ? `
                    <div style="margin-top: 20px;">
                        <span class="code-label">Generated JavaScript:</span>
                        <div class="code-block">${report.configuration.customJS}</div>
                    </div>
                    ` : ''}
                </section>
    
                ${report.chatProgress && report.chatProgress.length > 0 ? `
                <section class="section">
                    <h2>💬 Generation Process</h2>
                    <p>This section shows the AI conversation that generated this report.</p>
                    <div style="max-height: 400px; overflow-y: auto; background: #f8f9fa; padding: 15px; border-radius: 6px;">
                        ${report.chatProgress.map(step => `
                        <div style="margin-bottom: 15px; padding: 10px; background: white; border-radius: 4px; border-left: 3px solid ${step.type === 'user' ? '#007acc' :
                step.type === 'assistant' ? '#333' :
                    step.type === 'tool_call' ? '#ff8c00' :
                        step.type === 'tool_result' ? '#228b22' : '#ff4500'
            };">
                            <div style="font-weight: 600; color: #495057; margin-bottom: 5px;">
                                ${step.type.replace('_', ' ').toUpperCase()}${step.toolName ? ` (${step.toolName})` : ''}
                                <span style="float: right; font-weight: normal; font-size: 0.8em; color: #6c757d;">
                                    ${new Date(step.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                            <div style="white-space: pre-wrap; font-size: 0.9em;">${step.content || step.toolOutput || step.error || 'No content'
            }</div>
                        </div>
                        `).join('')}
                    </div>
                </section>
                ` : ''}
            </div>
    
            <footer class="footer">
                <p>Generated by ${report.metadata.generatedBy} • ${new Date(report.metadata.exportedAt).toLocaleString()}</p>
            </footer>
        </div>
    </body>
    </html>`;
    }
}

import * as vscode from 'vscode';
import { AnalysisViewConfig, ChartData, WebviewMessage, ChatProgressStep } from './types';
import { CopilotIntegration } from './CopilotIntegration';
import { ErrorReportingService } from './ValidationService';

export class AnalysisViewPlaygroundProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'analysisViewConfig';
    private _view?: vscode.WebviewView;
    private _panel?: vscode.WebviewPanel;
    private _config: AnalysisViewConfig = {
        name: 'Analysis Visualization',
        description: '',
        datasetPath: '',
        sqlQuery: '',
        customCSS: '',
        customJS: '',
        selectedModel: undefined,
        selectedMcpServer: undefined
    };
    private _copilotIntegration: CopilotIntegration;
    private _currentChatHistory: vscode.LanguageModelChatMessage[] = [];
    private _currentChatProgress: ChatProgressStep[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._copilotIntegration = new CopilotIntegration();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data: WebviewMessage) => {
            switch (data.type) {
                case 'configUpdate':
                    this._config = { ...this._config, ...data.config };
                    break;
                case 'generate':
                    this._generateAndExecute(data.description || this._config.description);
                    break;
                case 'exportConfig':
                    this._exportConfiguration();
                    break;
                case 'getAvailableModels':
                    this._getAvailableModels();
                    break;
                case 'getAvailableMcpServers':
                    this._getAvailableMcpServers();
                    break;
                case 'toggleChatProgress':
                    this._view?.webview.postMessage({
                        type: 'chatProgress',
                        chatProgress: this._currentChatProgress
                    });
                    break;
                case 'clearChatProgress':
                    this._currentChatProgress = [];
                    this._currentChatHistory = [];
                    this._view?.webview.postMessage({
                        type: 'chatProgress',
                        chatProgress: this._currentChatProgress
                    });
                    break;
                case 'clearAll':
                    this._config.sqlQuery = '';
                    this._config.customJS = '';
                    this._config.description = '';
                    this._currentChatProgress = [];
                    this._currentChatHistory = [];
                    this._view?.webview.postMessage({
                        type: 'configCleared',
                        config: this._config
                    });
                    this._view?.webview.postMessage({
                        type: 'chatProgress',
                        chatProgress: this._currentChatProgress
                    });
                    break;
            }
        });
    }

    public openPlayground() {
        if (this._view) {
            this._view.show?.(true);
        }
    }

    public openExecutionPanel() {
        if (this._panel) {
            this._panel.reveal();
        } else {
            this._panel = vscode.window.createWebviewPanel(
                'analysisViewExecution',
                'Analysis View - Execution',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [this._extensionUri],
                    retainContextWhenHidden: true
                }
            );

            this._panel.webview.html = this._getExecutionHtmlForWebview(this._panel.webview);

            this._panel.onDidDispose(() => {
                this._panel = undefined;
            });
        }
    }

    public exportConfiguration() {
        this._exportConfiguration();
    }

    private async _getAvailableModels() {
        try {
            await new Promise(resolve => setTimeout(resolve, 100));

            const models = await this._copilotIntegration.getAvailableModels();
            const modelOptions = models.map(model => ({
                id: model.id,
                name: `${model.name || model.id} (${model.vendor})`,
                family: model.family || 'unknown'
            }));

            this._view?.webview.postMessage({
                type: 'availableModels',
                models: modelOptions
            });

            if (models.length === 0) {
                vscode.window.showWarningMessage('No Copilot models available. Please ensure GitHub Copilot is installed and authenticated.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get available models: ${error}`);

            this._view?.webview.postMessage({
                type: 'availableModels',
                models: []
            });
        }
    }

    private async _getAvailableMcpServers() {
        try {
            await new Promise(resolve => setTimeout(resolve, 100));

            const mcpServers = await this._copilotIntegration.getAvailableMcpServers();

            this._view?.webview.postMessage({
                type: 'availableMcpServers',
                servers: mcpServers
            });

            if (mcpServers.length === 0) {
                vscode.window.showWarningMessage('No MCP servers available. Please ensure MCP services are configured and running.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get available MCP servers: ${error}`);

            this._view?.webview.postMessage({
                type: 'availableMcpServers',
                servers: []
            });
        }
    }

    private async _generateAndExecute(description: string, retryCount: number = 0): Promise<void> {
        const maxRetries = 3;
        
        try {
            this._view?.webview.postMessage({
                type: 'progress',
                status: 'started',
                message: retryCount > 0 ? `Retry ${retryCount}: Generating visualization...` : 'Generating visualization...'
            });

            await new Promise(resolve => setTimeout(resolve, 800));

            this._view?.webview.postMessage({
                type: 'progress',
                status: 'generating',
                message: 'Creating SQL query and visualization code...'
            });

            const generatedCode = await this._copilotIntegration.generateCodeWithLanguageModel(
                description,
                this._config.datasetPath,
                this._config.selectedModel,
                this._config.selectedMcpServer,
                this._currentChatHistory,
                (step: ChatProgressStep) => {
                    this._currentChatProgress.push(step);
                    this._view?.webview.postMessage({
                        type: 'chatProgressUpdated',
                        chatProgress: this._currentChatProgress
                    });
                }
            );

            if (!generatedCode) {
                throw new Error('Failed to generate code');
            }

            this._currentChatProgress = generatedCode.chatProgress || this._currentChatProgress;

            this._config.sqlQuery = generatedCode.sql;
            this._config.customJS = generatedCode.javascript;

            this._view?.webview.postMessage({
                type: 'codeGenerated',
                config: this._config
            });

            this._view?.webview.postMessage({
                type: 'chatProgressUpdated',
                chatProgress: this._currentChatProgress
            });

            this._view?.webview.postMessage({
                type: 'progress',
                status: 'executing',
                message: 'Running SQL query and rendering visualization...'
            });

            let data: ChartData = { columnNames: [], rows: [] };
            let sqlSuccess = false;

            try {
                data = await this.executeSQLWithMCPReaderService(
                    this._config.sqlQuery,
                    this._config.datasetPath
                );
                sqlSuccess = true;
            } catch (error) {
                if (retryCount < maxRetries) {
                    this._view?.webview.postMessage({
                        type: 'progress',
                        status: 'retrying',
                        message: `SQL failed, regenerating query...`
                    });

                    this._currentChatHistory.push(
                        vscode.LanguageModelChatMessage.Assistant(`SQL:\n${this._config.sqlQuery}\n\nJavaScript:\n${this._config.customJS}`),
                        vscode.LanguageModelChatMessage.User(`SQL query failed with error: ${error}. Fix the SQL query.`)
                    );

                    return this._generateAndExecute(description, retryCount + 1);
                }
                
                this._view?.webview.postMessage({
                    type: 'progress',
                    status: 'error',
                    message: `SQL execution failed: ${error}`
                });
                throw error;
            }

            this.openExecutionPanel();

            if (this._panel) {
                this._panel.webview.postMessage({
                    type: 'executeVisualization',
                    data: data,
                    config: this._config
                });

                await new Promise(resolve => setTimeout(resolve, 2000));

                const success = await this._checkVisualizationSuccess();

                if (!success && retryCount < maxRetries) {
                    const errorContext = `Visualization failed. Data: ${data.rows.length} rows, columns: ${data.columnNames.join(', ')}. Fix both SQL and JavaScript code.`;
                    
                    this._view?.webview.postMessage({
                        type: 'progress',
                        status: 'retrying',
                        message: `Attempt ${retryCount + 1}/${maxRetries}: Fixing SQL and JavaScript...`
                    });

                    this._currentChatHistory.push(
                        vscode.LanguageModelChatMessage.Assistant(`SQL:\n${this._config.sqlQuery}\n\nJavaScript:\n${this._config.customJS}`),
                        vscode.LanguageModelChatMessage.User(errorContext)
                    );

                    return this._generateAndExecute(description, retryCount + 1);
                }

                this._view?.webview.postMessage({
                    type: 'progress',
                    status: 'completed',
                    message: 'Visualization completed successfully!'
                });

                if (success) {
                    this._currentChatHistory = [];
                }
            }

        } catch (error) {
            if (retryCount < maxRetries) {
                this._view?.webview.postMessage({
                    type: 'progress',
                    status: 'retrying',
                    message: `Attempt ${retryCount + 1}/${maxRetries}: Error occurred, regenerating...`
                });

                this._currentChatHistory.push(
                    vscode.LanguageModelChatMessage.User(`Error: ${error}. Fix both SQL and JavaScript code.`)
                );

                return this._generateAndExecute(description, retryCount + 1);
            }

            this._view?.webview.postMessage({
                type: 'progress',
                status: 'error',
                message: `Generation failed after ${maxRetries} attempts: ${error}`
            });
            vscode.window.showErrorMessage(`Generation failed: ${error}`);
        }
    }

    private async _checkVisualizationSuccess(): Promise<boolean> {
        try {
            if (!this._panel) return false;
            
            return new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(false), 3000);
                
                this._panel!.webview.onDidReceiveMessage((message) => {
                    if (message.type === 'visualizationStatus') {
                        clearTimeout(timeout);
                        resolve(message.success);
                    }
                });
                
                this._panel!.webview.postMessage({ type: 'checkStatus' });
            });
        } catch {
            return false;
        }
    }

    private async executeSQLWithMCPReaderService(sqlQuery: string, datasetPath: string): Promise<ChartData> {
        try {
            const toolResult = await vscode.lm.invokeTool(
                'mcp_reader-servic_query_dataset',
                {
                    input: {
                        datasets: [
                            {
                                name: 'Base',
                                path: datasetPath,
                                sql: sqlQuery
                            }
                        ],
                        limit: 1000,
                        result_only: true
                    },
                    toolInvocationToken: undefined,
                },
                new vscode.CancellationTokenSource().token
            );

            let resultData: any = {};
            for (const contentItem of toolResult.content) {
                const typedContent = contentItem as vscode.LanguageModelTextPart;
                try {
                    let rawData = typedContent.value;
                    
                    if (rawData.startsWith('Error') || rawData.includes('error') || rawData.includes('Error')) {
                        throw new Error(`MCP tool returned error: ${rawData}`);
                    }
                    
                    rawData = rawData.replace(/^Sample data:\s*/, '');
                    const data = JSON.parse(rawData);
                    if (Array.isArray(data)) {
                        resultData = data[0];
                    } else {
                        resultData = data;
                    }
                } catch (parseError) {
                    console.error(parseError);
                    ErrorReportingService.logInfo(`Could not parse tool result as JSON: ${typedContent.value}`);
                    resultData = typedContent.value;
                }
            }
            let columnNames: string[] = [];
            if (Array.isArray(resultData) && resultData.length > 0 && typeof resultData[0] === 'object') {
                columnNames = Object.keys(resultData[0]);
            } else if (typeof resultData === 'string') {
                columnNames = ['data'];
                resultData = [{ data: resultData }];
            }
            return {
                rows: resultData,
                columnNames: columnNames
            };
        } catch (error) {
            throw new Error(`MCP Reader Service execution failed: ${error}`);
        }
    }

    private _exportConfiguration() {
        const exportData = {
            ...this._config,
            exportedAt: new Date().toISOString()
        };

        vscode.env.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
            vscode.window.showInformationMessage('Configuration copied to clipboard!');
        });
    }

    private _getExecutionHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Analysis View - Execution</title>
            <script src="https://cdn.plot.ly/plotly-3.0.2.min.js"></script>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 0;
                    margin: 0;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                
                .header {
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background-color: var(--vscode-sideBar-background);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    min-height: 48px;
                }
                
                .header h1 {
                    margin: 0;
                    color: var(--vscode-foreground);
                    font-size: 14px;
                    font-weight: 600;
                }
                
                #visualization-container {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-descriptionForeground);
                    position: relative;
                    min-height: 400px;
                }
                
                .empty-state {
                    text-align: center;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                    opacity: 0.7;
                    max-width: 400px;
                    line-height: 1.5;
                    padding: 40px 20px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Analysis View</h1>
            </div>
            
            <div id="visualization-container">
                <div class="empty-state">
                    <div>Ready to generate your visualization</div>
                    <div style="opacity: 0.6; margin-top: 8px;">Configure your analysis in the sidebar and click Generate</div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let visualizationSuccess = false;
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'executeVisualization':
                            executeVisualizationInPanel(message.data, message.config);
                            break;
                        case 'checkStatus':
                            vscode.postMessage({ 
                                type: 'visualizationStatus', 
                                success: visualizationSuccess 
                            });
                            break;
                    }
                });
                
                function executeVisualizationInPanel(data, config) {
                    try {
                        const container = document.getElementById('visualization-container');
                        container.innerHTML = '';
                        
                        if (config.customJS) {
                            try {
                                const executeJS = new Function('data', 'Plotly', 'container', \`
                                    try {                                                                                
                                        \${config.customJS}
                                        return true;
                                    } catch (error) {
                                        console.error('Visualization error:', error);
                                        container.innerHTML = '<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center; font-size: 13px;"><strong>Visualization Error:</strong><br>' + error.message + '</div>';
                                        return false;
                                    }
                                \`);
                                
                                visualizationSuccess = executeJS(data.rows, Plotly, 'visualization-container');
                            } catch (error) {
                                console.error('Execution error:', error);
                                container.innerHTML = \`<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center; font-size: 13px;">Error: \${error.message}</div>\`;
                                visualizationSuccess = false;
                            }
                        } else {
                            container.innerHTML = '<div class="empty-state">No visualization code available</div>';
                            visualizationSuccess = false;
                        }
                        
                    } catch (error) {
                        document.getElementById('visualization-container').innerHTML = 
                            \`<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center; font-size: 13px;">Error: \${error.message}</div>\`;
                        visualizationSuccess = false;
                    }
                }
            </script>
        </body>
        </html>`;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Analysis View</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    padding: 0;
                    margin: 0;
                    font-size: 13px;
                    line-height: 1.4;
                }
                
                .container {
                    padding: 16px;
                    max-width: 100%;
                }
                
                .section {
                    margin-bottom: 24px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 16px;
                }
                
                .section-header {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .section-header::before {
                    content: '';
                    width: 3px;
                    height: 16px;
                    background-color: var(--vscode-textLink-foreground);
                    border-radius: 2px;
                }
                
                .input-group {
                    margin-bottom: 16px;
                }
                
                .input-group:last-child {
                    margin-bottom: 0;
                }
                
                label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 12px;
                    color: var(--vscode-foreground);
                    font-weight: 500;
                }
                
                .input-hint {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                    opacity: 0.8;
                    line-height: 1.3;
                }
                
                input, textarea, select {
                    width: 100%;
                    padding: 8px 12px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    box-sizing: border-box;
                    transition: all 0.15s ease;
                }
                
                input:focus, textarea:focus, select:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
                
                textarea {
                    resize: vertical;
                    min-height: 90px;
                    font-family: var(--vscode-editor-font-family);
                    line-height: 1.5;
                }
                
                .code-textarea {
                    min-height: 140px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    line-height: 1.4;
                }
                
                .button-group {
                    display: flex;
                    gap: 6px;
                    margin-top: 12px;
                }
                
                .action-button {
                    flex: 1;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
                    font-weight: 500;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 26px;
                }
                
                .action-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                    transform: translateY(-1px);
                }
                
                .action-button:active:not(:disabled) {
                    transform: translateY(0);
                }
                
                .action-button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                
                .action-button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                }
                
                .action-button.secondary:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .action-button.clear {
                    background-color: transparent;
                    color: var(--vscode-descriptionForeground);
                    border: 1px solid var(--vscode-input-border);
                    opacity: 0.8;
                    font-size: 10px;
                    padding: 6px 10px;
                    flex: 0 0 auto;
                    min-width: 60px;
                }
                
                .action-button.clear:hover:not(:disabled) {
                    background-color: var(--vscode-list-hoverBackground);
                    color: var(--vscode-foreground);
                    opacity: 1;
                    border-color: var(--vscode-button-border);
                    transform: none;
                }
                
                .loading-state::before {
                    content: "";
                    width: 12px;
                    height: 12px;
                    border: 2px solid var(--vscode-button-foreground);
                    border-top: 2px solid transparent;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-right: 4px;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .validation-error {
                    color: var(--vscode-inputValidation-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    border-radius: 4px;
                    padding: 6px 8px;
                    font-size: 11px;
                    margin-top: 4px;
                    line-height: 1.3;
                    animation: fadeIn 0.2s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .model-select-container {
                    position: relative;
                }
                
                .custom-select {
                    position: relative;
                    cursor: pointer;
                }
                
                .custom-select-trigger {
                    width: 100%;
                    padding: 6px 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
                    box-sizing: border-box;
                    transition: all 0.15s ease;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    min-height: 28px;
                }
                
                .custom-select-trigger:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
                
                .custom-select-trigger:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .custom-select-arrow {
                    font-size: 8px;
                    color: var(--vscode-descriptionForeground);
                    transition: transform 0.2s ease;
                }
                
                .custom-select.open .custom-select-arrow {
                    transform: rotate(180deg);
                }
                
                .custom-select-options {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background-color: var(--vscode-dropdown-background);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 4px;
                    z-index: 1000;
                    max-height: 200px;
                    overflow-y: auto;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                    display: none;
                }
                
                .custom-select.open .custom-select-options {
                    display: block;
                }
                
                .custom-select-option {
                    padding: 6px 8px;
                    cursor: pointer;
                    font-size: 11px;
                    color: var(--vscode-dropdown-foreground);
                    transition: background-color 0.15s ease;
                }
                
                .custom-select-option:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .custom-select-option.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                
                .custom-select-option.loading {
                    opacity: 0.6;
                    font-style: italic;
                }
                
                .model-select-container label {
                    font-size: 11px;
                    margin-bottom: 4px;
                }
                
                .model-hint {
                    font-size: 10px;
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.7;
                    margin-top: 2px;
                    line-height: 1.2;
                }
                
                .progress-container {
                    margin-top: 16px;
                    margin-bottom: 16px;
                    padding: 16px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    display: none;
                    opacity: 0;
                    transition: all 0.3s ease;
                }
                
                .progress-container.visible {
                    display: block;
                    opacity: 1;
                }
                
                .progress-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .progress-spinner {
                    display: inline-block;
                    width: 14px;
                    height: 14px;
                    border: 2px solid var(--vscode-panel-border);
                    border-top: 2px solid var(--vscode-button-background);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-right: 10px;
                }
                
                .progress-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                }
                
                .progress-message {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    line-height: 1.4;
                    opacity: 0.9;
                }
                
                .chat-progress-toggle {
                    margin-top: 12px;
                    border-top: 1px solid var(--vscode-panel-border);
                    padding-top: 12px;
                }
                
                .toggle-button {
                    background: none;
                    border: none;
                    color: var(--vscode-textLink-foreground);
                    cursor: pointer;
                    font-size: 11px;
                    padding: 6px 0;
                    display: flex;
                    align-items: center;
                    font-family: var(--vscode-font-family);
                    transition: color 0.15s ease;
                }
                
                .toggle-button:hover {
                    color: var(--vscode-textLink-activeForeground);
                }
                
                .toggle-icon {
                    margin-right: 6px;
                    transition: transform 0.2s ease;
                    font-size: 10px;
                }
                
                .toggle-icon.expanded {
                    transform: rotate(90deg);
                }
                
                .chat-progress-container {
                    margin-top: 8px;
                    margin-bottom: 8px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 3px;
                    max-height: 400px;
                    overflow: hidden;
                }
                
                .chat-progress-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background-color: var(--vscode-sideBar-background);
                    font-size: 11px;
                    font-weight: 600;
                }
                
                .chat-progress-controls {
                    display: flex;
                    gap: 8px;
                }
                
                .chat-control-button {
                    background: none;
                    border: none;
                    color: var(--vscode-textLink-foreground);
                    cursor: pointer;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 2px;
                    font-family: var(--vscode-font-family);
                    transition: background-color 0.15s;
                }
                
                .chat-control-button:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    color: var(--vscode-textLink-activeForeground);
                }
                
                .chat-progress-content {
                    max-height: 320px;
                    overflow-y: auto;
                    padding: 4px;
                }
                
                .chat-step {
                    margin-bottom: 4px;
                    border-radius: 3px;
                    font-size: 11px;
                    line-height: 1.4;
                    border: 1px solid transparent;
                }
                
                .chat-step.user {
                    background-color: rgba(0, 122, 204, 0.08);
                    border-left: 3px solid var(--vscode-textLink-foreground);
                }
                
                .chat-step.assistant {
                    background-color: rgba(40, 40, 40, 0.2);
                    border-left: 3px solid var(--vscode-foreground);
                }
                
                .chat-step.tool_call {
                    background-color: rgba(255, 165, 0, 0.08);
                    border-left: 3px solid orange;
                }
                
                .chat-step.tool_result {
                    background-color: rgba(34, 139, 34, 0.08);
                    border-left: 3px solid green;
                }
                
                .chat-step.error {
                    background-color: rgba(255, 69, 0, 0.08);
                    border-left: 3px solid var(--vscode-errorForeground);
                }
                
                .chat-step-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 8px;
                    cursor: pointer;
                    user-select: none;
                    transition: background-color 0.15s;
                }
                
                .chat-step-header:hover {
                    background-color: rgba(255, 255, 255, 0.05);
                }
                
                .chat-step-header-left {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .chat-step-expand-icon {
                    font-size: 10px;
                    transition: transform 0.2s;
                    color: var(--vscode-descriptionForeground);
                }
                
                .chat-step-expand-icon.expanded {
                    transform: rotate(90deg);
                }
                
                .chat-step-type {
                    text-transform: capitalize;
                    font-weight: 600;
                    opacity: 0.9;
                }
                
                .chat-step-timestamp {
                    font-size: 10px;
                    opacity: 0.6;
                }
                
                .chat-step-content {
                    white-space: pre-wrap;
                    word-break: break-word;
                    max-height: 200px;
                    overflow-y: auto;
                    font-family: var(--vscode-editor-font-family);
                    background-color: rgba(0, 0, 0, 0.1);
                    padding: 8px;
                    margin: 0 8px 6px 8px;
                    border-radius: 2px;
                    font-size: 10px;
                    line-height: 1.3;
                    display: none;
                    transition: all 0.2s ease;
                    opacity: 0;
                }
                
                .chat-step.expanded .chat-step-content {
                    display: block;
                    opacity: 1;
                }
                
                .chat-step-tool-info {
                    font-size: 10px;
                    opacity: 0.7;
                    margin-top: 2px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="section">
                    <div class="section-header">Dataset & Visualization Goal</div>
                    
                    <div class="input-group">
                        <label for="datasetPath">Dataset Path</label>
                        <input type="text" id="datasetPath" placeholder="s3://bucket/path/to/dataset" />
                        <div class="input-hint">Enter the S3 path to your dataset</div>
                    </div>
                    
                    <div class="input-group">
                        <label for="description">What do you want to visualize?</label>
                        <textarea id="description" placeholder="Describe your visualization goal in detail...&#10;&#10;Examples:&#10;• Show distribution of values by category&#10;• Create a time series chart of events&#10;• Display correlation between two variables"></textarea>
                        <div class="input-hint">Be specific about the type of chart and data you want to explore</div>
                    </div>
                    
                    <div class="input-group model-select-container">
                        <label for="modelSelect">AI Model</label>
                        <div class="custom-select" id="modelSelect">
                            <div class="custom-select-trigger" tabindex="0">
                                <span class="custom-select-value">Default model</span>
                                <span class="custom-select-arrow">▼</span>
                            </div>
                            <div class="custom-select-options">
                                <div class="custom-select-option selected" data-value="">Default model</div>
                            </div>
                        </div>
                        <div class="model-hint">Optional: Select a specific model</div>
                    </div>
                    
                    <div class="input-group model-select-container">
                        <label for="mcpSelect">MCP Data Tools</label>
                        <div class="custom-select" id="mcpSelect">
                            <div class="custom-select-trigger" tabindex="0">
                                <span class="custom-select-value">All available tools</span>
                                <span class="custom-select-arrow">▼</span>
                            </div>
                            <div class="custom-select-options">
                                <div class="custom-select-option selected" data-value="all">All available tools</div>
                            </div>
                        </div>
                        <div class="model-hint">Optional: Select specific data analysis tools</div>
                    </div>
                    
                    <div class="button-group">
                        <button class="action-button generate-button" onclick="generate()">Generate Visualization</button>
                        <button class="action-button clear" onclick="clearAll()">Clear</button>
                    </div>
                    
                    <div class="progress-container" id="progressContainer">
                        <div class="progress-header">
                            <div class="progress-spinner"></div>
                            <div class="progress-title" id="progressTitle">Working...</div>
                        </div>
                        <div class="progress-message" id="progressMessage">Starting...</div>
                        <div class="chat-progress-toggle" id="chatProgressToggle" style="display: none;">
                            <button class="toggle-button" onclick="toggleChatProgress()">
                                <span class="toggle-icon">▶</span> Show Chat Progress
                            </button>
                        </div>
                    </div>
                    
                    <div class="chat-progress-container" id="chatProgressContainer" style="display: none;">
                        <div class="chat-progress-header">
                            <span>Chat Progress</span>
                            <div class="chat-progress-controls">
                                <button class="chat-control-button" onclick="expandAllChatSteps()">Expand All</button>
                                <button class="chat-control-button" onclick="collapseAllChatSteps()">Collapse All</button>
                                <button class="chat-control-button" onclick="clearChatProgress()">Clear</button>
                            </div>
                        </div>
                        <div class="chat-progress-content" id="chatProgressContent">
                            <!-- Chat progress will be populated here -->
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <div class="section-header">Generated Code</div>
                    
                    <div class="input-group">
                        <label for="sqlQuery">SQL Query</label>
                        <textarea id="sqlQuery" class="code-textarea" readonly placeholder="Generated SQL query will appear here..."></textarea>
                        <div class="input-hint">This query will be executed against your dataset</div>
                    </div>
                    
                    <div class="input-group">
                        <label for="customJS">JavaScript (Plotly)</label>
                        <textarea id="customJS" class="code-textarea" placeholder="Generated visualization code will appear here..."></textarea>
                        <div class="input-hint">Plotly.js code for rendering the visualization</div>
                    </div>
                    
                    <div class="button-group">
                        <button class="action-button secondary" onclick="exportConfig()">Export Configuration</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function initializeInterface() {
                    setupEventListeners();
                    document.getElementById('datasetPath').value = '';
                }
                
                function setupEventListeners() {
                    document.getElementById('description').addEventListener('input', updateConfig);
                    document.getElementById('datasetPath').addEventListener('input', updateConfig);
                    document.getElementById('customJS').addEventListener('input', updateConfig);
                    
                    setupCustomSelect();
                    setupMcpSelect();
                }
                
                function setupCustomSelect() {
                    const customSelect = document.getElementById('modelSelect');
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const options = customSelect.querySelector('.custom-select-options');
                    let modelsLoaded = false;
                    
                    const loadModels = () => {
                        if (!modelsLoaded) {
                            const valueSpan = trigger.querySelector('.custom-select-value');
                            valueSpan.textContent = 'Loading models...';
                            trigger.style.opacity = '0.6';
                            vscode.postMessage({ type: 'getAvailableModels' });
                            modelsLoaded = true;
                        }
                    };
                    
                    const toggleDropdown = () => {
                        const isOpen = customSelect.classList.contains('open');
                        
                        // Close all dropdowns first
                        document.querySelectorAll('.custom-select').forEach(select => {
                            select.classList.remove('open');
                        });
                        
                        if (!isOpen) {
                            if (!modelsLoaded) {
                                loadModels();
                            }
                            customSelect.classList.add('open');
                        }
                    };
                    
                    trigger.addEventListener('click', toggleDropdown);
                    trigger.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    });
                    
                    // Close dropdown when clicking outside
                    document.addEventListener('click', (e) => {
                        if (!customSelect.contains(e.target)) {
                            customSelect.classList.remove('open');
                        }
                    });
                    
                    // Handle option selection
                    options.addEventListener('click', (e) => {
                        const option = e.target.closest('.custom-select-option');
                        if (option && !option.classList.contains('loading')) {
                            // Remove selected class from all options
                            options.querySelectorAll('.custom-select-option').forEach(opt => {
                                opt.classList.remove('selected');
                            });
                            
                            // Add selected class to clicked option
                            option.classList.add('selected');
                            
                            // Update trigger text
                            const valueSpan = trigger.querySelector('.custom-select-value');
                            valueSpan.textContent = option.textContent;
                            
                            // Close dropdown
                            customSelect.classList.remove('open');
                            
                            // Update config
                            updateConfig();
                        }
                    });
                }
                
                function setupMcpSelect() {
                    const customSelect = document.getElementById('mcpSelect');
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const options = customSelect.querySelector('.custom-select-options');
                    let serversLoaded = false;
                    
                    const loadServers = () => {
                        if (!serversLoaded) {
                            const valueSpan = trigger.querySelector('.custom-select-value');
                            valueSpan.textContent = 'Loading tools...';
                            trigger.style.opacity = '0.6';
                            vscode.postMessage({ type: 'getAvailableMcpServers' });
                            serversLoaded = true;
                        }
                    };
                    
                    const toggleDropdown = () => {
                        const isOpen = customSelect.classList.contains('open');
                        
                        // Close all dropdowns first
                        document.querySelectorAll('.custom-select').forEach(select => {
                            select.classList.remove('open');
                        });
                        
                        if (!isOpen) {
                            if (!serversLoaded) {
                                loadServers();
                            }
                            customSelect.classList.add('open');
                        }
                    };
                    
                    trigger.addEventListener('click', toggleDropdown);
                    trigger.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    });
                    
                    // Close dropdown when clicking outside
                    document.addEventListener('click', (e) => {
                        if (!customSelect.contains(e.target)) {
                            customSelect.classList.remove('open');
                        }
                    });
                    
                    // Handle option selection
                    options.addEventListener('click', (e) => {
                        const option = e.target.closest('.custom-select-option');
                        if (option && !option.classList.contains('loading')) {
                            // Remove selected class from all options
                            options.querySelectorAll('.custom-select-option').forEach(opt => {
                                opt.classList.remove('selected');
                            });
                            
                            // Add selected class to clicked option
                            option.classList.add('selected');
                            
                            // Update trigger text
                            const valueSpan = trigger.querySelector('.custom-select-value');
                            valueSpan.textContent = option.textContent;
                            
                            // Close dropdown
                            customSelect.classList.remove('open');
                            
                            // Update config
                            updateConfig();
                        }
                    });
                }
                
                function updateConfig() {
                    const modelSelect = document.getElementById('modelSelect');
                    const modelOption = modelSelect.querySelector('.custom-select-option.selected');
                    const selectedModel = modelOption ? modelOption.getAttribute('data-value') : '';
                    
                    const mcpSelect = document.getElementById('mcpSelect');
                    const mcpOption = mcpSelect.querySelector('.custom-select-option.selected');
                    const selectedMcpServer = mcpOption ? mcpOption.getAttribute('data-value') : 'all';
                    
                    const config = {
                        description: document.getElementById('description').value,
                        datasetPath: document.getElementById('datasetPath').value,
                        sqlQuery: document.getElementById('sqlQuery').value,
                        customJS: document.getElementById('customJS').value,
                        selectedModel: selectedModel || undefined,
                        selectedMcpServer: selectedMcpServer || 'all'
                    };
                    
                    vscode.postMessage({ type: 'configUpdate', config: config });
                }
                
                function generate() {
                    const description = document.getElementById('description').value.trim();
                    const datasetPath = document.getElementById('datasetPath').value.trim();
                    
                    if (!description) {
                        showValidationError('description', 'Please describe what you want to visualize.');
                        return;
                    }
                    
                    if (!datasetPath) {
                        showValidationError('datasetPath', 'Please provide a dataset path.');
                        return;
                    }
                    
                    const button = document.querySelector('.generate-button');
                    const progressContainer = document.getElementById('progressContainer');
                    const chatProgressToggle = document.getElementById('chatProgressToggle');
                    const chatProgressContainer = document.getElementById('chatProgressContainer');
                    
                    // Update button state
                    button.disabled = true;
                    button.classList.add('loading-state');
                    button.innerHTML = 'Generating...';
                    
                    // Show progress
                    progressContainer.classList.add('visible');
                    chatProgressToggle.style.display = 'block';
                    chatProgressContainer.style.display = 'none';
                    
                    // Reset chat progress toggle state
                    resetChatProgressToggle();
                    
                    vscode.postMessage({ type: 'generate', description: description });
                }
                
                function showValidationError(fieldId, message) {
                    const field = document.getElementById(fieldId);
                    field.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
                    field.focus();
                    
                    // Show temporary error message
                    let errorDiv = field.parentNode.querySelector('.validation-error');
                    if (!errorDiv) {
                        errorDiv = document.createElement('div');
                        errorDiv.className = 'validation-error';
                        errorDiv.style.cssText = 'color: var(--vscode-inputValidation-errorForeground); font-size: 11px; margin-top: 4px;';
                        field.parentNode.appendChild(errorDiv);
                    }
                    errorDiv.textContent = message;
                    
                    // Clear error after 3 seconds
                    setTimeout(() => {
                        field.style.borderColor = '';
                        if (errorDiv) errorDiv.remove();
                    }, 3000);
                }
                
                function resetChatProgressToggle() {
                    const toggleButton = document.querySelector('.toggle-button');
                    const toggleIcon = toggleButton.querySelector('.toggle-icon');
                    toggleButton.innerHTML = '<span class="toggle-icon">▶</span> Show Chat Progress';
                    toggleIcon?.classList.remove('expanded');
                }
                
                function toggleChatProgress() {
                    const container = document.getElementById('chatProgressContainer');
                    const toggleButton = document.querySelector('.toggle-button');
                    const toggleIcon = toggleButton.querySelector('.toggle-icon');
                    
                    if (container.style.display === 'none') {
                        container.style.display = 'block';
                        toggleButton.innerHTML = '<span class="toggle-icon expanded">▶</span> Hide Chat Progress';
                        toggleIcon.classList.add('expanded');
                        
                        // Request chat progress data
                        vscode.postMessage({ type: 'toggleChatProgress' });
                    } else {
                        container.style.display = 'none';
                        toggleButton.innerHTML = '<span class="toggle-icon">▶</span> Show Chat Progress';
                        toggleIcon.classList.remove('expanded');
                    }
                }
                
                function toggleChatStep(stepElement) {
                    const icon = stepElement.querySelector('.chat-step-expand-icon');
                    const isExpanded = stepElement.classList.contains('expanded');
                    
                    if (isExpanded) {
                        stepElement.classList.remove('expanded');
                        icon.classList.remove('expanded');
                    } else {
                        stepElement.classList.add('expanded');
                        icon.classList.add('expanded');
                    }
                }
                
                function expandAllChatSteps() {
                    const steps = document.querySelectorAll('.chat-step');
                    steps.forEach(step => {
                        step.classList.add('expanded');
                        const icon = step.querySelector('.chat-step-expand-icon');
                        if (icon) icon.classList.add('expanded');
                    });
                }
                
                function collapseAllChatSteps() {
                    const steps = document.querySelectorAll('.chat-step');
                    steps.forEach(step => {
                        step.classList.remove('expanded');
                        const icon = step.querySelector('.chat-step-expand-icon');
                        if (icon) icon.classList.remove('expanded');
                    });
                }
                
                function clearAll() {
                    // Clear form fields
                    document.getElementById('description').value = '';
                    document.getElementById('sqlQuery').value = '';
                    document.getElementById('customJS').value = '';
                    
                    // Hide progress and chat containers
                    const progressContainer = document.getElementById('progressContainer');
                    const chatProgressToggle = document.getElementById('chatProgressToggle');
                    const chatProgressContainer = document.getElementById('chatProgressContainer');
                    
                    progressContainer.classList.remove('visible');
                    chatProgressToggle.style.display = 'none';
                    chatProgressContainer.style.display = 'none';
                    
                    // Reset chat progress toggle state
                    resetChatProgressToggle();
                    
                    // Reset generate button
                    resetGenerateButton();
                    
                    // Send clear message to extension
                    vscode.postMessage({ type: 'clearAll' });
                }
                
                function resetGenerateButton() {
                    const button = document.querySelector('.generate-button');
                    button.disabled = false;
                    button.classList.remove('loading-state');
                    button.innerHTML = 'Generate Visualization';
                }
                
                function clearChatProgress() {
                    vscode.postMessage({ type: 'clearChatProgress' });
                    
                    // Reset UI state
                    const chatProgressContainer = document.getElementById('chatProgressContainer');
                    const toggleButton = document.querySelector('.toggle-button');
                    const toggleIcon = toggleButton.querySelector('.toggle-icon');
                    
                    // Optionally close the chat progress view after clearing
                    chatProgressContainer.style.display = 'none';
                    toggleButton.innerHTML = '<span class="toggle-icon">▶</span> Show Chat Progress';
                    toggleIcon.classList.remove('expanded');
                }
                
                function renderChatProgress(chatProgress) {
                    const container = document.getElementById('chatProgressContent');
                    const header = document.querySelector('.chat-progress-header span');
                    
                    container.innerHTML = '';
                    
                    if (!chatProgress || chatProgress.length === 0) {
                        header.textContent = 'Chat Progress';
                        container.innerHTML = '<div style="opacity: 0.6; text-align: center; padding: 12px;">No chat progress available yet. Generate a visualization to see the conversation.</div>';
                        return;
                    }
                    
                    // Update header with step count
                    header.textContent = \`Chat Progress (\${chatProgress.length} steps)\`;
                    
                    chatProgress.forEach((step, index) => {
                        const stepElement = document.createElement('div');
                        stepElement.className = \`chat-step \${step.type}\`;
                        
                        const timestamp = new Date(step.timestamp).toLocaleTimeString();
                        let typeDisplay = step.type.replace('_', ' ');
                        if (step.toolName) {
                            typeDisplay += \` (\${step.toolName})\`;
                        }
                        
                        let contentToShow = step.content || 'No content';
                        
                        // Ensure content is a string
                        if (typeof contentToShow === 'object') {
                            contentToShow = JSON.stringify(contentToShow, null, 2);
                        } else {
                            contentToShow = String(contentToShow);
                        }
                        
                        if (step.toolOutput) {
                            contentToShow = String(step.toolOutput);
                        }
                        if (step.error) {
                            contentToShow = String(step.error);
                        }
                        
                        // Escape HTML in content
                        contentToShow = contentToShow.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        // Truncate content preview for header
                        const contentPreview = contentToShow.length > 100 ? 
                            contentToShow.substring(0, 100) + '...' : contentToShow;
                        
                        stepElement.innerHTML = \`
                            <div class="chat-step-header" onclick="toggleChatStep(this.parentElement)">
                                <div class="chat-step-header-left">
                                    <span class="chat-step-expand-icon">▶</span>
                                    <span class="chat-step-type">\${typeDisplay}</span>
                                </div>
                                <span class="chat-step-timestamp">\${timestamp}</span>
                            </div>
                            <div class="chat-step-content">\${contentToShow}</div>
                        \`;
                        
                        container.appendChild(stepElement);
                    });
                    
                    // Scroll to bottom
                    container.scrollTop = container.scrollHeight;
                }
                
                function exportConfig() {
                    vscode.postMessage({ type: 'exportConfig' });
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'codeGenerated':
                            document.getElementById('sqlQuery').value = message.config.sqlQuery || '';
                            document.getElementById('customJS').value = message.config.customJS || '';
                            break;
                        case 'configCleared':
                            document.getElementById('description').value = message.config.description || '';
                            document.getElementById('sqlQuery').value = message.config.sqlQuery || '';
                            document.getElementById('customJS').value = message.config.customJS || '';
                            break;
                        case 'availableModels':
                            populateModels(message.models);
                            break;
                        case 'availableMcpServers':
                            populateMcpServers(message.servers);
                            break;
                        case 'progress':
                            updateProgress(message.status, message.message);
                            break;
                        case 'chatProgress':
                        case 'chatProgressUpdated':
                            renderChatProgress(message.chatProgress);
                            break;
                    }
                });
                
                function updateProgress(status, message) {
                    document.getElementById('progressTitle').textContent = status.charAt(0).toUpperCase() + status.slice(1);
                    document.getElementById('progressMessage').textContent = message;
                    
                    const chatProgressToggle = document.getElementById('chatProgressToggle');
                    
                    // Show chat progress toggle once generation starts
                    if (status === 'generating' || status === 'executing' || status === 'retrying') {
                        chatProgressToggle.style.display = 'block';
                    }
                    
                    if (status === 'completed') {
                        setTimeout(() => {
                            const progressContainer = document.getElementById('progressContainer');
                            progressContainer.classList.remove('visible');
                            resetGenerateButton();
                        }, 2000);
                    } else if (status === 'error') {
                        setTimeout(() => {
                            resetGenerateButton();
                        }, 3000);
                    }
                }
                
                function populateModels(models) {
                    const customSelect = document.getElementById('modelSelect');
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const valueSpan = trigger.querySelector('.custom-select-value');
                    const options = customSelect.querySelector('.custom-select-options');
                    
                    // Reset trigger appearance
                    trigger.style.opacity = '1';
                    valueSpan.textContent = 'Default model';
                    
                    // Clear existing options
                    options.innerHTML = '';
                    
                    // Add default option
                    const defaultOption = document.createElement('div');
                    defaultOption.className = 'custom-select-option selected';
                    defaultOption.setAttribute('data-value', '');
                    defaultOption.textContent = 'Default model';
                    options.appendChild(defaultOption);
                    
                    // Add model options
                    models.forEach(model => {
                        const option = document.createElement('div');
                        option.className = 'custom-select-option';
                        option.setAttribute('data-value', model.id);
                        option.textContent = model.name;
                        options.appendChild(option);
                    });
                }
                
                function populateMcpServers(servers) {
                    const customSelect = document.getElementById('mcpSelect');
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const valueSpan = trigger.querySelector('.custom-select-value');
                    const options = customSelect.querySelector('.custom-select-options');
                    
                    // Reset trigger appearance
                    trigger.style.opacity = '1';
                    valueSpan.textContent = 'All available tools';
                    
                    // Clear existing options
                    options.innerHTML = '';
                    
                    // Add default "All Tools" option if servers exist
                    if (servers.length > 0) {
                        const allOption = servers.find(s => s.id === 'all');
                        if (allOption) {
                            const defaultOption = document.createElement('div');
                            defaultOption.className = 'custom-select-option selected';
                            defaultOption.setAttribute('data-value', 'all');
                            defaultOption.textContent = \`\${allOption.name} (\${allOption.toolCount} tools)\`;
                            options.appendChild(defaultOption);
                        }
                        
                        // Add server options (excluding the "all" option we already added)
                        servers.filter(s => s.id !== 'all').forEach(server => {
                            const option = document.createElement('div');
                            option.className = 'custom-select-option';
                            option.setAttribute('data-value', server.id);
                            option.textContent = \`\${server.name} (\${server.toolCount} tools)\`;
                            option.title = server.description || '';
                            options.appendChild(option);
                        });
                    } else {
                        // Add no tools available option
                        const noToolsOption = document.createElement('div');
                        noToolsOption.className = 'custom-select-option selected';
                        noToolsOption.setAttribute('data-value', '');
                        noToolsOption.textContent = 'No tools available';
                        noToolsOption.style.opacity = '0.6';
                        options.appendChild(noToolsOption);
                    }
                }
                
                document.addEventListener('DOMContentLoaded', initializeInterface);
                if (document.readyState !== 'loading') {
                    initializeInterface();
                }
            </script>
        </body>
        </html>`;
    }
}
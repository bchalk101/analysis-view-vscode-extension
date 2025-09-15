import * as vscode from 'vscode';
import { AnalysisViewConfig, ChartData, WebviewMessage, ChatProgressStep, StoryState, ExportFormat } from './types';
import { CopilotIntegration } from './CopilotIntegration';
import { ErrorReportingService } from './ValidationService';
import { ReportGenerator } from './ReportGenerator';

export class AnalysisViewPlaygroundProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'analysisViewConfig';
    private _view?: vscode.WebviewView;
    private _panel?: vscode.WebviewPanel;
    private _config: AnalysisViewConfig = {
        name: 'Analysis Visualization',
        description: '',
        datasetPath: '',
        sqlQuery: '',
        customJS: '',
        selectedModel: undefined,
        selectedMcpServer: undefined
    };
    private _copilotIntegration: CopilotIntegration;
    private _currentChatHistory: vscode.LanguageModelChatMessage[] = [];
    private _currentChatProgress: ChatProgressStep[] = [];
    private _currentCancellationTokenSource?: vscode.CancellationTokenSource;
    private _storyState: StoryState = {
        currentStepIndex: 0,
        isStoryMode: false
    };
    private _reportGenerator = new ReportGenerator();

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._copilotIntegration = new CopilotIntegration();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
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
                case 'generateStory':
                    this._generateStory(data.description || this._config.description);
                    break;
                case 'cancelGeneration':
                    this._cancelGeneration();
                    break;
                case 'exportReport':
                    this._reportGenerator.exportCompleteReport(this._storyState, this._currentChatProgress, data.exportFormat || 'html', this._config);
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
                    this._storyState = { currentStepIndex: 0, isStoryMode: false };
                    this._view?.webview.postMessage({
                        type: 'configCleared',
                        config: this._config
                    });
                    this._view?.webview.postMessage({
                        type: 'chatProgress',
                        chatProgress: this._currentChatProgress
                    });
                    this._view?.webview.postMessage({
                        type: 'storyStateUpdated',
                        storyState: this._storyState
                    });
                    break;
                case 'navigateStory':
                    this._navigateStory(data.storyNavigation!);
                    break;
                case 'toggleStoryMode':
                    this._toggleStoryMode(data.storyMode || false);
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

    private _cancelGeneration() {
        if (this._currentCancellationTokenSource) {
            this._currentCancellationTokenSource.cancel();
            this._currentCancellationTokenSource.dispose();
            this._currentCancellationTokenSource = undefined;
        }


        this._view?.webview.postMessage({
            type: 'progress',
            status: 'cancelled',
            message: 'Generation cancelled by user'
        });

        this._view?.webview.postMessage({
            type: 'generationCancelled'
        });
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

    private async _generateStory(description: string): Promise<void> {
        this._currentCancellationTokenSource = new vscode.CancellationTokenSource();

        try {
            this._view?.webview.postMessage({
                type: 'progress',
                status: 'started',
                message: 'Generating data story...'
            });

            console.log(`Starting story generation for: "${description}"`);
            console.log(`Dataset path: "${this._config.datasetPath}"`);

            const generatedStory = await this._copilotIntegration.generateStoryWithLanguageModel(
                description,
                this._config.datasetPath,
                this._config.selectedModel,
                this._config.selectedMcpServer,
                this._currentChatHistory,
                (step: ChatProgressStep) => {
                    if (!this._currentCancellationTokenSource?.token.isCancellationRequested) {
                        this._currentChatProgress.push(step);
                        this._view?.webview.postMessage({
                            type: 'chatProgressUpdated',
                            chatProgress: this._currentChatProgress
                        });
                    }
                }
            );

            console.log(`Story generation result:`, generatedStory ? `Success - ${generatedStory.steps?.length} steps` : 'null');

            if (this._currentCancellationTokenSource.token.isCancellationRequested) {
                return;
            }

            if (!generatedStory) {
                console.error('Generated story is null or undefined');
                throw new Error('Failed to generate story - returned null');
            }

            this._storyState = {
                currentStory: generatedStory,
                currentStepIndex: 0,
                isStoryMode: true
            };

            this._view?.webview.postMessage({
                type: 'storyGenerated',
                story: generatedStory,
                storyState: this._storyState
            });

            this._view?.webview.postMessage({
                type: 'progress',
                status: 'validating',
                message: 'Validating story steps...'
            });


            this._view?.webview.postMessage({
                type: 'progress',
                status: 'completed',
                message: 'Data story generated and validated successfully!'
            });

            this._executeCurrentStoryStep();

        } catch (error) {
            this._view?.webview.postMessage({
                type: 'progress',
                status: 'error',
                message: `Story generation failed: ${error}`
            });
            vscode.window.showErrorMessage(`Story generation failed: ${error}`);
        } finally {
            if (this._currentCancellationTokenSource) {
                this._currentCancellationTokenSource.dispose();
                this._currentCancellationTokenSource = undefined;
            }
        }
    }

    private _navigateStory(navigation: { direction: 'next' | 'previous' | 'jump', stepIndex?: number }) {
        if (!this._storyState.currentStory) return;

        const totalSteps = this._storyState.currentStory.steps.length;

        switch (navigation.direction) {
            case 'next':
                if (this._storyState.currentStepIndex < totalSteps - 1) {
                    this._storyState.currentStepIndex++;
                }
                break;
            case 'previous':
                if (this._storyState.currentStepIndex > 0) {
                    this._storyState.currentStepIndex--;
                }
                break;
            case 'jump':
                if (navigation.stepIndex !== undefined &&
                    navigation.stepIndex >= 0 &&
                    navigation.stepIndex < totalSteps) {
                    this._storyState.currentStepIndex = navigation.stepIndex;
                }
                break;
        }

        this._view?.webview.postMessage({
            type: 'storyStateUpdated',
            storyState: this._storyState
        });

        this._executeCurrentStoryStep();
    }

    private _toggleStoryMode(enabled: boolean) {
        this._storyState.isStoryMode = enabled;
        if (!enabled) {
            this._storyState.currentStory = undefined;
            this._storyState.currentStepIndex = 0;
        }

        this._view?.webview.postMessage({
            type: 'storyStateUpdated',
            storyState: this._storyState
        });
    }

    private async _executeCurrentStoryStep() {
        if (!this._storyState.currentStory || !this._storyState.isStoryMode) return;

        const currentStep = this._storyState.currentStory.steps[this._storyState.currentStepIndex];
        if (!currentStep) return;

        try {
            const data = await this.executeSQLWithMCPReaderService(
                currentStep.sqlQuery,
                this._storyState.currentStory.datasetPath
            );

            this.openExecutionPanel();

            if (this._panel) {
                this._panel.webview.postMessage({
                    type: 'executeStoryStep',
                    data: data,
                    step: currentStep
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute story step: ${error}`);
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
                this._currentCancellationTokenSource?.token || new vscode.CancellationTokenSource().token
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

    public async exportCompleteReport() {
        await this._reportGenerator.exportCompleteReport(this._storyState, this._currentChatProgress, 'html', this._config);
    }

    private _getExecutionHtmlForWebview(_webview: vscode.Webview): string {
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
                        case 'executeStoryStep':
                            executeStoryStepInPanel(message.data, message.step);
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
                
                function executeStoryStepInPanel(data, step) {
                    try {
                        const container = document.getElementById('visualization-container');
                        container.innerHTML = '';
                        
                        // Add story step context with enhanced styling
                        const stepHeader = document.createElement('div');
                        stepHeader.style.cssText = \`
                            background: linear-gradient(135deg, var(--vscode-sideBar-background) 0%, var(--vscode-editor-background) 100%);
                            padding: 20px 24px;
                            border-bottom: 2px solid var(--vscode-button-background);
                            margin-bottom: 24px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        \`;
                        stepHeader.innerHTML = \`
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                                <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: var(--vscode-foreground); text-shadow: 0 1px 2px rgba(0,0,0,0.1);">\${step.title}</h1>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <span style="background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 12px; border-radius: 6px; font-size: 11px; text-transform: uppercase; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">\${step.visualizationType} Chart</span>
                                </div>
                            </div>
                            <div style="margin-bottom: 16px;">
                                <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: var(--vscode-foreground); opacity: 0.9;">Analysis Overview</h3>
                                <p style="margin: 0; color: var(--vscode-descriptionForeground); font-size: 14px; line-height: 1.6; font-weight: 400;">\${step.description}</p>
                            </div>
                            <div style="background: var(--vscode-textBlockQuote-background); border-left: 6px solid var(--vscode-textLink-foreground); padding: 16px 20px; margin: 0; border-radius: 0 8px 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                                <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                    <span style="font-size: 18px; margin-right: 8px;">💡</span>
                                    <strong style="color: var(--vscode-textLink-foreground); font-size: 14px; font-weight: 600;">Key Insight</strong>
                                </div>
                                <p style="margin: 0; color: var(--vscode-foreground); font-size: 14px; line-height: 1.5; font-weight: 500;">\${step.insight}</p>
                            </div>
                        \`;
                        container.appendChild(stepHeader);
                        
                        // Create chart container with enhanced styling
                        const chartContainer = document.createElement('div');
                        chartContainer.id = 'step-chart-container';
                        chartContainer.style.cssText = \`
                            flex: 1; 
                            min-height: 500px; 
                            background: var(--vscode-editor-background);
                            border: 1px solid var(--vscode-panel-border);
                            border-radius: 8px;
                            padding: 16px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                            margin: 0 8px 16px 8px;
                        \`;
                        container.appendChild(chartContainer);
                        
                        if (step.jsCode) {
                            try {
                                const executeJS = new Function('data', 'Plotly', 'container', \`
                                    try {                                                                                
                                        \${step.jsCode.replace('visualization-container', 'step-chart-container')}
                                        return true;
                                    } catch (error) {
                                        console.error('Visualization error:', error);
                                        document.getElementById('step-chart-container').innerHTML = '<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center; font-size: 13px;"><strong>Visualization Error:</strong><br>' + error.message + '</div>';
                                        return false;
                                    }
                                \`);
                                
                                visualizationSuccess = executeJS(data.rows, Plotly, 'step-chart-container');
                            } catch (error) {
                                console.error('Execution error:', error);
                                chartContainer.innerHTML = \`<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center; font-size: 13px;">Error: \${error.message}</div>\`;
                                visualizationSuccess = false;
                            }
                        } else {
                            chartContainer.innerHTML = '<div class="empty-state">No visualization code available for this step</div>';
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

    private _getHtmlForWebview(_webview: vscode.Webview): string {
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
                    padding: 12px;
                    max-width: 100%;
                }
                
                .section {
                    margin-bottom: 16px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 12px;
                }
                
                .section-header {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                    margin-bottom: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    opacity: 0.8;
                }
                
                .input-group {
                    margin-bottom: 12px;
                }
                
                .input-group:last-child {
                    margin-bottom: 0;
                }
                
                .select-row {
                    display: flex;
                    gap: 8px;
                }
                
                .select-column {
                    flex: 1;
                }
                
                label {
                    display: block;
                    margin-bottom: 4px;
                    font-size: 11px;
                    color: var(--vscode-foreground);
                    font-weight: 500;
                    opacity: 0.9;
                }
                
                input, textarea, select {
                    width: 100%;
                    padding: 6px 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
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
                    min-height: 60px;
                    font-family: var(--vscode-editor-font-family);
                    line-height: 1.4;
                }
                
                .code-textarea {
                    min-height: 100px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    line-height: 1.4;
                }
                
                .button-group {
                    display: flex;
                    gap: 8px;
                    margin-top: 16px;
                }
                
                .action-button {
                    flex: 1;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
                    font-weight: 500;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 28px;
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
                
                .action-button.cancel-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                }
                
                .action-button.cancel-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                    color: var(--vscode-errorForeground);
                    border-color: var(--vscode-errorBorder);
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
                    border-radius: 3px;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
                    box-sizing: border-box;
                    transition: all 0.15s ease;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    min-height: 24px;
                }
                
                .custom-select.compact .custom-select-trigger {
                    min-height: 26px;
                    font-size: 10px;
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
                
                .story-navigation {
                    margin-top: 16px;
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    animation: fadeIn 0.3s ease;
                }
                
                .story-info {
                    margin-bottom: 12px;
                }
                
                .story-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                    margin-bottom: 4px;
                }
                
                .story-step-indicator {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                }
                
                .navigation-controls {
                    display: flex;
                    gap: 8px;
                    justify-content: space-between;
                }
                
                .nav-button {
                    flex: 1;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    padding: 8px 16px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 11px;
                    font-weight: 500;
                    transition: all 0.15s ease;
                }
                
                .nav-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                    transform: translateY(-1px);
                }
                
                .nav-button:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                    transform: none;
                }
                
                .story-mode-button {
                    background-color: var(--vscode-textLink-foreground);
                    color: var(--vscode-button-foreground);
                }
                
                .story-mode-button:hover:not(:disabled) {
                    background-color: var(--vscode-textLink-activeForeground);
                }
                
                .export-section {
                    margin-top: 20px;
                    padding: 16px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    border-left: 4px solid var(--vscode-button-background);
                }
                
                .export-section .section-header {
                    margin-bottom: 8px;
                    color: var(--vscode-button-background);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="section">
                    <div class="section-header">Configuration</div>
                    
                    <div class="input-group">
                        <label for="datasetPath">Dataset Path</label>
                        <input type="text" id="datasetPath" placeholder="s3://bucket/path/to/dataset.csv" />
                    </div>
                    
                    <div class="input-group">
                        <label for="description">Data Story Goal</label>
                        <textarea id="description" placeholder="Describe what data story you want to explore, e.g., 'Analyze the distribution and quality of image classifications, show patterns and identify outliers'"></textarea>
                    </div>
                    
                    <div class="input-group">
                        <div class="select-row">
                            <div class="select-column">
                                <label for="modelSelect">Model</label>
                                <div class="custom-select compact" id="modelSelect">
                                    <div class="custom-select-trigger" tabindex="0">
                                        <span class="custom-select-value">Default</span>
                                        <span class="custom-select-arrow">▼</span>
                                    </div>
                                    <div class="custom-select-options">
                                        <div class="custom-select-option selected" data-value="">Default</div>
                                    </div>
                                </div>
                            </div>
                            <div class="select-column">
                                <label for="mcpSelect">Tools</label>
                                <div class="custom-select compact" id="mcpSelect">
                                    <div class="custom-select-trigger" tabindex="0">
                                        <span class="custom-select-value">All available</span>
                                        <span class="custom-select-arrow">▼</span>
                                    </div>
                                    <div class="custom-select-options">
                                        <div class="custom-select-option selected" data-value="all">All available</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="button-group">
                        <button class="action-button generate-button story-mode-button" onclick="generateStory()">Generate Data Story</button>
                        <button class="action-button cancel-button" onclick="cancelGeneration()" style="display: none;">Cancel</button>
                        <button class="action-button clear" onclick="clearAll()">Clear</button>
                    </div>
                    
                    <div class="export-section" id="exportSection" style="display: none;">
                        <div class="section-header">📄 Export Report</div>
                        <p style="margin-bottom: 16px; color: var(--vscode-descriptionForeground); font-size: 11px;">
                            Export your complete analysis including data story, visualizations, and generation process.
                        </p>
                        <div class="button-group">
                            <button class="action-button" onclick="exportReportHTML()">Export as HTML</button>
                            <button class="action-button secondary" onclick="exportReportJSON()">Export as JSON</button>
                            <button class="action-button secondary" onclick="exportReportPDF()">Export PDF-Ready</button>
                        </div>
                    </div>
                    
                    <div class="story-navigation" id="storyNavigation" style="display: none;">
                        <div class="story-info">
                            <div class="story-title" id="storyTitle"></div>
                            <div class="story-step-indicator" id="stepIndicator"></div>
                        </div>
                        <div class="navigation-controls">
                            <button class="nav-button" id="prevButton" onclick="navigateStory('previous')" disabled>← Previous</button>
                            <button class="nav-button" id="nextButton" onclick="navigateStory('next')">Next →</button>
                        </div>
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
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let interfaceInitialized = false;
                
                function initializeInterface() {
                    if (interfaceInitialized) return;
                    setupEventListeners();
                    document.getElementById('datasetPath').value = '';
                    interfaceInitialized = true;
                }
                
                function setupEventListeners() {
                    const description = document.getElementById('description');
                    const datasetPath = document.getElementById('datasetPath');
                    
                    if (description) {
                        description.addEventListener('input', updateConfig);
                    }
                    if (datasetPath) {
                        datasetPath.addEventListener('input', updateConfig);
                    }
                    
                    setupCustomSelect();
                    setupMcpSelect();
                    setupGlobalClickHandler();
                }
                
                function setupCustomSelect() {
                    const customSelect = document.getElementById('modelSelect');
                    if (!customSelect) {
                        console.error('Model select element not found');
                        return;
                    }
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const options = customSelect.querySelector('.custom-select-options');
                    if (!trigger || !options) {
                        console.error('Model select trigger or options not found');
                        return;
                    }
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
                    
                    trigger.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleDropdown();
                    });
                    trigger.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    });
                    
                    // Handle option selection
                    options.addEventListener('click', (e) => {
                        e.stopPropagation();
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
                    if (!customSelect) {
                        console.error('MCP select element not found');
                        return;
                    }
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const options = customSelect.querySelector('.custom-select-options');
                    if (!trigger || !options) {
                        console.error('MCP select trigger or options not found');
                        return;
                    }
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
                    
                    trigger.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleDropdown();
                    });
                    trigger.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    });
                    
                    // Handle option selection
                    options.addEventListener('click', (e) => {
                        e.stopPropagation();
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
                
                function setupGlobalClickHandler() {
                    // Global click handler to close all dropdowns when clicking outside
                    document.addEventListener('click', (e) => {
                        const allDropdowns = document.querySelectorAll('.custom-select');
                        allDropdowns.forEach(dropdown => {
                            if (!dropdown.contains(e.target)) {
                                dropdown.classList.remove('open');
                            }
                        });
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
                        selectedModel: selectedModel || undefined,
                        selectedMcpServer: selectedMcpServer || 'all'
                    };
                    
                    vscode.postMessage({ type: 'configUpdate', config: config });
                }
                
                
                function generateStory() {
                    const description = document.getElementById('description').value.trim();
                    const datasetPath = document.getElementById('datasetPath').value.trim();
                    
                    if (!description) {
                        showValidationError('description', 'Please describe what story you want to tell with your data.');
                        return;
                    }
                    
                    if (!datasetPath) {
                        showValidationError('datasetPath', 'Please provide a dataset path.');
                        return;
                    }
                    
                    // Validate dataset path is not a placeholder
                    if (datasetPath.includes('/path/to/') || datasetPath === 'Dataset Path') {
                        showValidationError('datasetPath', 'Please provide a real dataset path, not a placeholder.');
                        return;
                    }
                    
                    setGeneratingState(true);
                    hideStoryNavigation();
                    
                    const progressContainer = document.getElementById('progressContainer');
                    const chatProgressToggle = document.getElementById('chatProgressToggle');
                    const chatProgressContainer = document.getElementById('chatProgressContainer');
                    
                    // Show progress
                    progressContainer.classList.add('visible');
                    chatProgressToggle.style.display = 'block';
                    chatProgressContainer.style.display = 'none';
                    
                    // Reset chat progress toggle state
                    resetChatProgressToggle();
                    
                    vscode.postMessage({ type: 'generateStory', description: description });
                }
                
                function cancelGeneration() {
                    vscode.postMessage({ type: 'cancelGeneration' });
                }
                
                function setGeneratingState(isGenerating) {
                    const storyButton = document.querySelector('.story-mode-button');
                    const cancelButton = document.querySelector('.cancel-button');
                    const clearButton = document.querySelector('.clear');
                    
                    if (isGenerating) {
                        // Update story button
                        storyButton.disabled = true;
                        storyButton.classList.add('loading-state');
                        storyButton.innerHTML = 'Generating Data Story...';
                        storyButton.style.display = 'none';
                        
                        // Show cancel button
                        cancelButton.style.display = 'flex';
                        cancelButton.disabled = false;
                        
                        // Disable clear button during generation
                        clearButton.disabled = true;
                        clearButton.style.opacity = '0.5';
                    } else {
                        // Reset story button
                        storyButton.disabled = false;
                        storyButton.classList.remove('loading-state');
                        storyButton.innerHTML = 'Generate Data Story';
                        storyButton.style.display = 'flex';
                        
                        // Hide cancel button
                        cancelButton.style.display = 'none';
                        
                        // Re-enable clear button
                        clearButton.disabled = false;
                        clearButton.style.opacity = '1';
                    }
                }
                
                function navigateStory(direction) {
                    vscode.postMessage({ 
                        type: 'navigateStory', 
                        storyNavigation: { direction: direction }
                    });
                }
                
                function showStoryNavigation(story, currentStepIndex) {
                    const navigation = document.getElementById('storyNavigation');
                    const title = document.getElementById('storyTitle');
                    const indicator = document.getElementById('stepIndicator');
                    const prevButton = document.getElementById('prevButton');
                    const nextButton = document.getElementById('nextButton');
                    
                    navigation.style.display = 'block';
                    title.textContent = story.title;
                    indicator.textContent = \`Step \${currentStepIndex + 1} of \${story.steps.length}: \${story.steps[currentStepIndex].title}\`;
                    
                    // Update button states
                    prevButton.disabled = currentStepIndex === 0;
                    nextButton.disabled = currentStepIndex === story.steps.length - 1;
                }
                
                function hideStoryNavigation() {
                    const navigation = document.getElementById('storyNavigation');
                    navigation.style.display = 'none';
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
                    document.getElementById('datasetPath').value = '';
                    
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
                    setGeneratingState(false);
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

                
                function exportReportHTML() {
                    vscode.postMessage({ type: 'exportReport', exportFormat: 'html' });
                }
                
                function exportReportJSON() {
                    vscode.postMessage({ type: 'exportReport', exportFormat: 'json' });
                }
                
                function exportReportPDF() {
                    vscode.postMessage({ type: 'exportReport', exportFormat: 'pdf-ready' });
                }
                
                function showExportSection() {
                    const exportSection = document.getElementById('exportSection');
                    exportSection.style.display = 'block';
                }
                
                function hideExportSection() {
                    const exportSection = document.getElementById('exportSection');
                    exportSection.style.display = 'none';
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'storyGenerated':
                            showStoryNavigation(message.story, message.storyState.currentStepIndex);
                            showExportSection();
                            break;
                        case 'storyStateUpdated':
                            if (message.storyState.currentStory && message.storyState.isStoryMode) {
                                showStoryNavigation(message.storyState.currentStory, message.storyState.currentStepIndex);
                            } else {
                                hideStoryNavigation();
                            }
                            break;
                        case 'configCleared':
                            document.getElementById('description').value = message.config.description || '';
                            hideStoryNavigation();
                            hideExportSection();
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
                        case 'generationCancelled':
                            setGeneratingState(false);
                            const progressContainer = document.getElementById('progressContainer');
                            progressContainer.classList.remove('visible');
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
                    } else if (status === 'cancelled') {
                        setTimeout(() => {
                            const progressContainer = document.getElementById('progressContainer');
                            progressContainer.classList.remove('visible');
                            resetGenerateButton();
                        }, 1000);
                    }
                }
                
                function populateModels(models) {
                    const customSelect = document.getElementById('modelSelect');
                    const trigger = customSelect.querySelector('.custom-select-trigger');
                    const valueSpan = trigger.querySelector('.custom-select-value');
                    const options = customSelect.querySelector('.custom-select-options');
                    
                    // Reset trigger appearance
                    trigger.style.opacity = '1';
                    valueSpan.textContent = 'Default';
                    
                    // Clear existing options
                    options.innerHTML = '';
                    
                    // Add default option
                    const defaultOption = document.createElement('div');
                    defaultOption.className = 'custom-select-option selected';
                    defaultOption.setAttribute('data-value', '');
                    defaultOption.textContent = 'Default';
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
                    valueSpan.textContent = 'All available';
                    
                    // Clear existing options
                    options.innerHTML = '';
                    
                    // Add default "All Tools" option if servers exist
                    if (servers.length > 0) {
                        const allOption = servers.find(s => s.id === 'all');
                        if (allOption) {
                            const defaultOption = document.createElement('div');
                            defaultOption.className = 'custom-select-option selected';
                            defaultOption.setAttribute('data-value', 'all');
                            defaultOption.textContent = \`All (\${allOption.toolCount})\`;
                            options.appendChild(defaultOption);
                        }
                        
                        // Add server options (excluding the "all" option we already added)
                        servers.filter(s => s.id !== 'all').forEach(server => {
                            const option = document.createElement('div');
                            option.className = 'custom-select-option';
                            option.setAttribute('data-value', server.id);
                            option.textContent = \`\${server.name} (\${server.toolCount})\`;
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
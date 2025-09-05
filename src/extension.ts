import * as vscode from 'vscode';
import { AnalysisViewPlaygroundProvider } from './AnalysisViewPlaygroundProvider';
import { ErrorReportingService, PerformanceMonitor } from './ValidationService';

function registerMCPServices(context: vscode.ExtensionContext) {
    try {
        ErrorReportingService.logInfo('MCP services can be configured by users...');

        ErrorReportingService.logInfo('To use MCP services with this extension:');
        ErrorReportingService.logInfo('1. Install and configure MCP servers for your data sources');
        ErrorReportingService.logInfo('2. Register MCP server definitions in VS Code');
        ErrorReportingService.logInfo('3. The extension will automatically detect available MCP tools');

    } catch (error) {
        ErrorReportingService.logError(error as Error, 'mcp-configuration');
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        PerformanceMonitor.startTimer('extension-activation');

        // Initialize error reporting
        ErrorReportingService.initialize(context);
        ErrorReportingService.logInfo('Analysis View Playground extension is activating...');

        // Register MCP Services information
        registerMCPServices(context);

        const playgroundProvider = new AnalysisViewPlaygroundProvider(context.extensionUri);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('analysisViewConfig', playgroundProvider)
        );

        const openPlaygroundCommand = vscode.commands.registerCommand('analysis-view-playground.openPlayground', async () => {
            try {
                await PerformanceMonitor.measureAsync('open-playground', async () => {
                    playgroundProvider.openPlayground();
                });
            } catch (error) {
                ErrorReportingService.logError(error as Error, 'open-playground');
                vscode.window.showErrorMessage('Failed to open playground');
            }
        });

        const exportCommand = vscode.commands.registerCommand('analysis-view-playground.exportToMainApp', () => {
            try {
                playgroundProvider.exportConfiguration();
            } catch (error) {
                ErrorReportingService.logError(error as Error, 'export-configuration');
                vscode.window.showErrorMessage('Failed to export configuration');
            }
        });

        // Add a command to check MCP server connection status
        const checkMCPConnectionCommand = vscode.commands.registerCommand('analysis-view-playground.checkMCPConnection', async () => {
            try {
                ErrorReportingService.logInfo('Checking MCP connection status...');

                if (vscode.lm && typeof (vscode.lm as any).getMcpServerDefinitions === 'function') {
                    try {
                        const servers = await (vscode.lm as any).getMcpServerDefinitions();
                        ErrorReportingService.logInfo(`MCP Servers registered: ${servers?.length || 0}`);
                    } catch (serverError) {
                        ErrorReportingService.logInfo('Could not retrieve MCP server definitions');
                    }
                } else {
                    ErrorReportingService.logInfo('VS Code getMcpServerDefinitions API not available');
                }

                vscode.window.showInformationMessage('MCP Connection check complete. Check console for details.');

            } catch (error) {
                ErrorReportingService.logError(error as Error, 'mcp-connection-check');
                vscode.window.showErrorMessage('Failed to check MCP connection');
            }
        });

        // Add a command to test MCP service status
        const testMCPCommand = vscode.commands.registerCommand('analysis-view-playground.testMCPService', async () => {
            try {
                ErrorReportingService.logInfo('=== MCP SERVICE TEST START ===');
                ErrorReportingService.logInfo('Testing MCP service availability...');

                // First, test if any MCP servers are configured
                ErrorReportingService.logInfo('=== MCP SERVER CONFIGURATION TEST ===');
                try {
                    ErrorReportingService.logInfo('Checking for configured MCP servers...');
                    ErrorReportingService.logInfo('Users should configure their own MCP servers through VS Code settings');
                    ErrorReportingService.logInfo('or by installing MCP server extensions that register services automatically');

                } catch (serverTestError) {
                    ErrorReportingService.logError(serverTestError as Error, 'mcp-server-check');
                    ErrorReportingService.logInfo('No MCP servers configured - users need to set up their own data sources');
                }

                const hasLMApi = !!(vscode.lm && typeof vscode.lm.selectChatModels === 'function');
                ErrorReportingService.logInfo(`VS Code LM API available: ${hasLMApi}`);

                if (hasLMApi) {
                    try {
                        const models = await vscode.lm.selectChatModels();
                        ErrorReportingService.logInfo(`Available chat models: ${models.length}`);
                        models.forEach((model, index) => {
                            ErrorReportingService.logInfo(`  Model ${index + 1}: ${model.id} (${model.vendor})`);
                        });

                        ErrorReportingService.logInfo('=== DETAILED MCP MODEL TESTING ===');



                        const copilotModel = models.find(m => m.family === 'claude-sonnet-4' || m.id.includes('claude-sonnet-4'));
                        const testModel = copilotModel || models[0];

                        ErrorReportingService.logInfo(`Using model for MCP test: ${testModel.id} (${testModel.vendor})`);

                        try {
                            ErrorReportingService.logInfo('=== STREAMING TEST WITH MCP TOOL INVOCATION ===');

                            const mcpPrompt = `I need to analyze some data. Can you help me count the number of rows in a dataset? Please use any available MCP tools for data analysis.`;
                            ErrorReportingService.logInfo(`Sending MCP-specific test prompt: ${mcpPrompt}`);

                            const availableTools = vscode.lm ? vscode.lm.tools : [];
                            ErrorReportingService.logInfo(`Available VS Code tools: ${availableTools.length}`);
                            availableTools.forEach((tool, index) => {
                                ErrorReportingService.logInfo(`  Tool ${index + 1}: ${tool.name} (tags: ${tool.tags.join(', ')})`);
                            });

                            const mcpTools = availableTools.filter(tool =>
                                tool.name.toLowerCase().includes('reader') ||
                                tool.name.toLowerCase().includes('data') ||
                                tool.name.toLowerCase().includes('query')
                            );

                            ErrorReportingService.logInfo(`MCP-related tools found: ${mcpTools.length}`);
                            mcpTools.forEach((tool, index) => {
                                ErrorReportingService.logInfo(`  MCP Tool ${index + 1}: ${tool.name}`);
                            });

                            const options: vscode.LanguageModelChatRequestOptions = {
                                justification: 'Testing MCP service integration with streaming',
                            };

                            if (mcpTools.length > 0) {
                                options.tools = mcpTools;
                                options.toolMode = vscode.LanguageModelChatToolMode.Auto;
                                ErrorReportingService.logInfo(`Configured request with ${mcpTools.length} MCP tools`);
                            }

                            const response = await testModel.sendRequest([
                                vscode.LanguageModelChatMessage.User(mcpPrompt)
                            ], options, new vscode.CancellationTokenSource().token);

                            ErrorReportingService.logInfo('=== PROCESSING STREAMING RESPONSE ===');

                            let responseText = '';
                            const toolCalls: vscode.LanguageModelToolCallPart[] = [];

                            for await (const part of response.stream) {
                                if (part instanceof vscode.LanguageModelTextPart) {
                                    responseText += part.value;
                                    ErrorReportingService.logInfo(`Text chunk: ${part.value.substring(0, 100)}...`);
                                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                                    toolCalls.push(part);
                                    ErrorReportingService.logInfo(`Tool call detected: ${part.name} with input: ${JSON.stringify(part.input)}`);
                                }
                            }

                            ErrorReportingService.logInfo(`=== RESPONSE SUMMARY ===`);
                            ErrorReportingService.logInfo(`Total response text length: ${responseText.length}`);
                            ErrorReportingService.logInfo(`Number of tool calls: ${toolCalls.length}`);
                            ErrorReportingService.logInfo(`Full response text: ${responseText}`);

                            // Process any tool calls
                            if (toolCalls.length > 0) {
                                ErrorReportingService.logInfo('=== PROCESSING TOOL CALLS ===');

                                for (const toolCall of toolCalls) {
                                    try {
                                        ErrorReportingService.logInfo(`Invoking tool: ${toolCall.name}`);
                                        ErrorReportingService.logInfo(`Tool input: ${JSON.stringify(toolCall.input)}`);

                                        const toolResult = await vscode.lm.invokeTool(
                                            toolCall.name,
                                            {
                                                input: toolCall.input,
                                                toolInvocationToken: undefined,
                                                tokenizationOptions: {
                                                    tokenBudget: 1000,
                                                    countTokens: async (content: string) => Math.ceil(content.length / 4)
                                                }
                                            },
                                            new vscode.CancellationTokenSource().token
                                        );

                                        ErrorReportingService.logInfo(`Tool result received for ${toolCall.name}`);
                                        ErrorReportingService.logInfo(`Tool result content: ${JSON.stringify(toolResult.content)}`);

                                    } catch (toolError) {
                                        ErrorReportingService.logError(toolError as Error, 'tool-invocation');
                                        ErrorReportingService.logInfo(`Tool call failed for ${toolCall.name}: ${toolError}`);
                                    }
                                }

                                vscode.window.showInformationMessage(`MCP Test: Model made ${toolCalls.length} tool calls! Check console for details.`);
                            }

                        } catch (testError) {
                            ErrorReportingService.logError(testError as Error, 'streaming-mcp-test');
                            ErrorReportingService.logInfo(`Streaming MCP test failed: ${testError}`);
                            vscode.window.showErrorMessage(`MCP streaming test failed: ${testError}`);
                        }


                    } catch (modelError) {
                        ErrorReportingService.logError(modelError as Error, 'test-chat-models');
                        vscode.window.showErrorMessage(`Failed to test chat models: ${modelError}`);
                    }
                } else {
                    vscode.window.showWarningMessage('VS Code LM API not available - MCP features will not work');
                }

                // Check if VS Code has MCP-related settings
                const config = vscode.workspace.getConfiguration();
                const mcpSettings = config.get('mcp') || {};
                ErrorReportingService.logInfo(`VS Code MCP Settings: ${JSON.stringify(mcpSettings)}`);

                // Check for GitHub Copilot extension
                const copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
                ErrorReportingService.logInfo(`GitHub Copilot Chat Extension: ${copilotExtension ? 'INSTALLED' : 'NOT FOUND'}`);
                if (copilotExtension) {
                    ErrorReportingService.logInfo(`  - Version: ${copilotExtension.packageJSON.version}`);
                    ErrorReportingService.logInfo(`  - Active: ${copilotExtension.isActive}`);
                }
            } catch (error) {
                ErrorReportingService.logError(error as Error, 'mcp-test');
                vscode.window.showErrorMessage('Failed to test MCP service');
            }
        });

        context.subscriptions.push(
            openPlaygroundCommand,
            exportCommand,
            testMCPCommand,
            checkMCPConnectionCommand
        );

        PerformanceMonitor.endTimer('extension-activation');
        ErrorReportingService.logInfo('Analysis View Playground extension activated successfully');

        vscode.window.showInformationMessage('Analysis View Playground is ready! Use "Test MCP Service Connection" to check MCP functionality.');

        // Auto-run MCP test in development mode
        if (process.env.NODE_ENV === 'development') {
            ErrorReportingService.logInfo('Development mode detected, auto-testing MCP service...');
            setTimeout(() => {
                vscode.commands.executeCommand('analysis-view-playground.testMCPService');
            }, 2000);
        }

    } catch (error) {
        ErrorReportingService.logError(error as Error, 'extension-activation');
        vscode.window.showErrorMessage('Failed to activate Analysis View Playground extension');
        throw error;
    }
}

export function deactivate() {
    ErrorReportingService.logInfo('Analysis View Playground extension is deactivating...');
}

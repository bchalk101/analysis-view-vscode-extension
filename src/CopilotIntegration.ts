import * as vscode from 'vscode';
import { ErrorReportingService } from './ValidationService';
import { ChatProgressStep, McpServerInfo, DataStory } from './types';
import {
  StoryGenerationPrompt,
  StoryGenerationProps,
} from './buildPrompt';
import { renderPrompt } from '@vscode/prompt-tsx';

export interface GeneratedCode {
  sql: string;
  javascript: string;
}

export interface GeneratedCodeWithProgress {
  sql: string;
  javascript: string;
  chatProgress: ChatProgressStep[];
  metadata?: AnalysisToolUserMetadata;
}

export interface AnalysisToolUserMetadata {
  toolCallsMetadata: ToolCallsMetadata;
}

export interface ToolCallsMetadata {
  toolCallRounds: any[];
  toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

export class CopilotIntegration {
  private static readonly MAX_TOOL_CALL_ROUNDS = 5;
  private static readonly MAX_TOOL_CALLS_PER_ROUND = 10;

  private addProgressStep(chatProgress: ChatProgressStep[], step: Omit<ChatProgressStep, 'timestamp'>, onProgress?: (step: ChatProgressStep) => void) {
    const progressStep = { ...step, timestamp: new Date().toISOString() };
    chatProgress.push(progressStep);
    if (onProgress) {
      onProgress(progressStep);
    }
  }

  private async accumulateTextFromStream(stream: AsyncIterable<any>) {
    let text = '';
    for await (const part of stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
      }
    }
    return text;
  }

  private formatToolResultContent(result: vscode.LanguageModelToolResult) {
    try {
      if (!result || !result.content) {
        return String(result || 'No content');
      }

      return result.content.map((c: any) => {
        if (c.type === 'text') {
          return c.text;
        }
        try {
          return JSON.stringify(c);
        } catch (jsonError) {
          return String(c);
        }
      }).join('\n');
    } catch (error) {
      return String(result || 'Error formatting tool result');
    }
  }

  private safeJsonStringify(obj: any): string {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      try {
        return JSON.stringify(obj, (key, value) => {
          if (typeof value === 'function') {
            return '[Function]';
          }
          if (typeof value === 'undefined') {
            return '[Undefined]';
          }
          if (typeof value === 'symbol') {
            return '[Symbol]';
          }
          if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: value.stack };
          }
          if (typeof value === 'object' && value !== null) {
            if (value.constructor && value.constructor.name !== 'Object') {
              return `[${value.constructor.name}]`;
            }
          }
          return value;
        });
      } catch (fallbackError) {
        return String(obj);
      }
    }
  }

  async getAvailableModels(): Promise<vscode.LanguageModelChat[]> {
    const maxRetries = 5;
    let attempt = 0;
    let delay = 200;
    while (attempt < maxRetries) {
      try {
        const models = await vscode.lm.selectChatModels();
        if (!models || models.length === 0) {
          throw new Error('No chat models available');
        }
        return models;
      } catch (error) {
        ErrorReportingService.logError(error as Error, 'get-available-models');
        if (attempt === maxRetries - 1) {
          return [];
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        attempt++;
      }
    }
    return [];
  }

  async getAvailableMcpServers(): Promise<McpServerInfo[]> {
    try {
      const availableTools = vscode.lm ? vscode.lm.tools : [];
      const mcpTools = availableTools.filter(tool => !tool.name.startsWith('copilot'));

      const serverMap = new Map<string, McpServerInfo>();

      mcpTools.forEach(tool => {
        const toolName = tool.name;
        const parts = toolName.split('_');
        let serverId = 'unknown';
        let serverName = 'Unknown Server';

        if (parts.length >= 2 && parts[0] === 'mcp') {
          serverId = parts[1];
          serverName = serverId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        } else if (toolName.includes('mcp')) {
          serverId = 'general-mcp';
          serverName = 'General MCP Tools';
        }

        if (!serverMap.has(serverId)) {
          serverMap.set(serverId, {
            id: serverId,
            name: serverName,
            description: `Tools from ${serverName}`,
            toolCount: 0,
            tools: []
          });
        }

        const serverInfo = serverMap.get(serverId)!;
        serverInfo.toolCount++;
        serverInfo.tools.push(toolName);
      });

      if (mcpTools.length > 0) {
        serverMap.set('all', {
          id: 'all',
          name: 'All Available Tools',
          description: 'Use all available MCP tools',
          toolCount: mcpTools.length,
          tools: mcpTools.map(tool => tool.name)
        });
      }

      return Array.from(serverMap.values()).sort((a, b) => {
        if (a.id === 'all') return -1;
        if (b.id === 'all') return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      ErrorReportingService.logError(error as Error, 'get-available-mcp-servers');
      return [];
    }
  }

  private getModel(models: vscode.LanguageModelChat[], selectedModelId?: string) {
    if (!models.length) return null;
    if (selectedModelId) return models.find(m => m.id === selectedModelId) || models[0];
    return models[0];
  }

  private extractPromptText(messages: vscode.LanguageModelChatMessage[]): string {
    return messages
      .filter(msg => msg.role === vscode.LanguageModelChatMessageRole.User)
      .map(msg => this.extractContentAsString(msg.content))
      .join('\n\n');
  }

  private extractContentAsString(content: any): string {
    if (typeof content === 'string') {
      return content;
    } else if (Array.isArray(content)) {
      return content
        .filter(part => part instanceof vscode.LanguageModelTextPart)
        .map(part => (part as vscode.LanguageModelTextPart).value)
        .join('');
    } else if (content && typeof content === 'object') {
      if (content.value) {
        return String(content.value);
      } else if (content.text) {
        return String(content.text);
      } else if (content.content) {
        return String(content.content);
      } else {
        return JSON.stringify(content);
      }
    } else {
      return String(content || '');
    }
  }

  private validateToolInputs(toolCalls: vscode.LanguageModelToolCallPart[], expectedDatasetPath: string) {
    toolCalls.forEach(toolCall => {
      if (toolCall.input && typeof toolCall.input === 'object') {
        const input = toolCall.input as any;
        if (input.datasets && Array.isArray(input.datasets)) {
          input.datasets.forEach((dataset: any) => {
            if (dataset.path && dataset.path !== expectedDatasetPath) {
              ErrorReportingService.logInfo(`Correcting dataset path from "${dataset.path}" to "${expectedDatasetPath}"`);
              dataset.path = expectedDatasetPath;
            }
          });
        }
      }
    });
  }

  private shouldTerminateToolCalls(
    currentToolResults: Array<{ toolCall: vscode.LanguageModelToolCallPart, result: any }>,
    allToolCallRounds: any[],
    chatProgress: ChatProgressStep[],
    onProgress?: (step: ChatProgressStep) => void
  ): boolean {
    if (allToolCallRounds.length >= CopilotIntegration.MAX_TOOL_CALL_ROUNDS - 1) {
      ErrorReportingService.logInfo('Approaching max tool call rounds, terminating early');
      return true;
    }

    const currentToolCallSignatures = currentToolResults.map(tr =>
      `${tr.toolCall.name}:${this.safeJsonStringify(tr.toolCall.input)}`
    );

    const allPreviousSignatures = allToolCallRounds.slice(0, -1).flatMap(round =>
      round.toolCalls.map((tc: any) => `${tc.name}:${this.safeJsonStringify(tc.input)}`)
    );

    const repeatedCalls = currentToolCallSignatures.filter(sig =>
      allPreviousSignatures.includes(sig)
    );

    if (repeatedCalls.length > 0) {
      ErrorReportingService.logInfo(`Detected repeated tool calls: ${repeatedCalls.join(', ')}`);
      this.addProgressStep(chatProgress, {
        type: 'error',
        content: `Detected repeated tool calls, terminating to prevent loops.`,
      }, onProgress);
      return true;
    }

    return false;
  }

  private async handleToolCalls(toolCalls: vscode.LanguageModelToolCallPart[], datasetPath: string, chatProgress: ChatProgressStep[], onProgress?: (step: ChatProgressStep) => void) {
    if (datasetPath) {
      this.validateToolInputs(toolCalls, datasetPath);
    }

    const toolResults: Array<{ toolCall: vscode.LanguageModelToolCallPart, result: any }> = [];
    for (const toolCall of toolCalls) {
      try {
        this.addProgressStep(chatProgress, {
          type: 'tool_call',
          content: `Calling tool: ${toolCall.name}`,
          toolName: toolCall.name,
          toolInput: this.safeJsonStringify(toolCall.input)
        }, onProgress);
        ErrorReportingService.logInfo(`Invoking tool: ${toolCall.name} with input: ${this.safeJsonStringify(toolCall.input)}`);

        const toolResult = await vscode.lm.invokeTool(
          toolCall.name,
          { input: toolCall.input, toolInvocationToken: undefined },
          new vscode.CancellationTokenSource().token
        );
        toolResults.push({ toolCall, result: toolResult });
        const resultText = this.formatToolResultContent(toolResult);
        this.addProgressStep(chatProgress, {
          type: 'tool_result',
          content: `Tool result from ${toolCall.name}`,
          toolName: toolCall.name,
          toolOutput: resultText.length > 500 ? resultText.substring(0, 500) + '...' : resultText
        }, onProgress);
      } catch (toolError) {
        ErrorReportingService.logError(toolError as Error, 'tool-execution');
        vscode.window.showWarningMessage(`Dataset exploration failed: ${toolError}`);
        this.addProgressStep(chatProgress, {
          type: 'error',
          content: `Tool execution failed`,
          toolName: toolCall.name,
          error: String(toolError)
        }, onProgress);
      }
    }
    return toolResults;
  }

  private parseStoryResponse(response: string): DataStory | null {
    try {
      ErrorReportingService.logInfo(`Parsing story response. Response length: ${response.length}`);
      ErrorReportingService.logInfo(`Response preview: ${response.substring(0, 500)}`);

      const jsonPatterns = [
        /```json\n([\s\S]*?)\n```/,           // Standard json block
        /```json\s*([\s\S]*?)\s*```/,         // json block with flexible whitespace
        /```\s*json\s*([\s\S]*?)\s*```/,      // json block with spaces
        /```\s*([\s\S]*?)\s*```/,             // Any code block
        /(\{[\s\S]*?"steps"[\s\S]*?\})/,      // Raw JSON with steps property
        /(\{[\s\S]*?"title"[\s\S]*?\})/       // Raw JSON with title property
      ];

      let jsonMatch = null;
      for (let i = 0; i < jsonPatterns.length; i++) {
        jsonMatch = response.match(jsonPatterns[i]);
        if (jsonMatch) {
          ErrorReportingService.logInfo(`Found JSON using pattern ${i}: ${jsonPatterns[i]}`);
          break;
        }
      }

      if (!jsonMatch) {
        ErrorReportingService.logInfo('No JSON found in response with any pattern');
        ErrorReportingService.logInfo(`Response content: ${response.substring(0, 1000)}`);
        return null;
      }

      ErrorReportingService.logInfo(`JSON block found: ${jsonMatch[1].substring(0, 200)}`);
      const storyData = JSON.parse(jsonMatch[1]);

      if (!storyData.title || !storyData.steps || !Array.isArray(storyData.steps)) {
        ErrorReportingService.logInfo(`Invalid story structure: title=${!!storyData.title}, steps=${Array.isArray(storyData.steps)}`);
        return null;
      }

      return this.createStoryFromData(storyData);
    } catch (error) {
      ErrorReportingService.logError(error as Error, 'story-parsing');
      ErrorReportingService.logInfo(`Raw response that failed to parse: ${response}`);
      return null;
    }
  }

  private generateUUID(): string {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch (error) {
      ErrorReportingService.logInfo('crypto.randomUUID not available, using fallback');
    }

    return 'story-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  private createStoryFromData(storyData: any): DataStory {
    try {
      const story: DataStory = {
        id: this.generateUUID(),
        title: storyData.title,
        description: storyData.description || '',
        steps: storyData.steps.map((step: any, index: number) => ({
          id: step.id || `step-${index + 1}`,
          title: step.title || `Step ${index + 1}`,
          description: step.description || '',
          insight: step.insight || '',
          sqlQuery: step.sqlQuery || step.sql || '',
          jsCode: step.jsCode || step.javascript || step.js || '',
          visualizationType: step.visualizationType || step.type || 'bar',
          order: step.order || index + 1
        })),
        createdAt: new Date().toISOString(),
        datasetPath: ''
      };

      ErrorReportingService.logInfo(`Created story with ${story.steps.length} steps`);
      story.steps.forEach((step, index) => {
        ErrorReportingService.logInfo(`Step ${index + 1}: title="${step.title}", hasSQL=${!!step.sqlQuery}, hasJS=${!!step.jsCode}`);
      });

      return story;
    } catch (error) {
      ErrorReportingService.logError(error as Error, 'story-creation');
      throw new Error(`Failed to create story structure: ${error}`);
    }
  }

  async generateStoryWithLanguageModel(
    description: string,
    datasetPath: string = '',
    selectedModelId?: string,
    selectedMcpServerId?: string,
    onProgress?: (step: ChatProgressStep) => void
  ): Promise<DataStory | null> {
    const chatProgress: ChatProgressStep[] = [];
    try {
      const models = await this.getAvailableModels();
      if (!models.length) {
        vscode.window.showWarningMessage('No chat models available. Please ensure GitHub Copilot is installed and authenticated.');
        return null;
      }

      let model = this.getModel(models, selectedModelId);
      if (!model) {
        vscode.window.showWarningMessage('No valid chat model found.');
        return null;
      }

      ErrorReportingService.logInfo(`Using model: ${model.id}, family: ${model.family}, vendor: ${model.vendor}, maxInputTokens: ${model.maxInputTokens}`);

      const availableTools = vscode.lm ? vscode.lm.tools : [];
      let mcpTools = availableTools.filter(tool => !tool.name.startsWith('copilot'));

      if (selectedMcpServerId && selectedMcpServerId !== 'all') {
        ErrorReportingService.logInfo(`Filtering MCP tools for server: ${selectedMcpServerId}`);
        mcpTools = mcpTools.filter(tool => {
          const parts = tool.name.split('_');
          if (parts.length >= 2 && parts[0] === 'mcp') {
            return parts[1] === selectedMcpServerId;
          }
          return selectedMcpServerId === 'general-mcp' && tool.name.includes('mcp');
        });
      }

      const storyProps: StoryGenerationProps = {
        description,
        datasetPath
      };
      const endpoint = { modelMaxPromptTokens: model.maxInputTokens };
      let messages: vscode.LanguageModelChatMessage[];
      try {
        const result = await renderPrompt(StoryGenerationPrompt, storyProps, endpoint, model);
        messages = result.messages;
      } catch (error) {
        ErrorReportingService.logError(error as Error, 'initial-render-prompt-failed');
        throw error;
      }
      const prompt = this.extractPromptText(messages);
      this.addProgressStep(chatProgress, { type: 'user', content: prompt }, onProgress);

      const accumulatedToolResults: Record<string, vscode.LanguageModelToolResult> = {};
      const toolCallRounds: any[] = [];
      let finalMessages = messages;
      let totalToolCallCount = 0;

      const runWithTools = async (): Promise<string> => {
        if (!model) {
          throw new Error('No valid model available');
        }

        if (toolCallRounds.length >= CopilotIntegration.MAX_TOOL_CALL_ROUNDS) {
          this.addProgressStep(chatProgress, {
            type: 'error',
            content: `Maximum tool call rounds reached (${CopilotIntegration.MAX_TOOL_CALL_ROUNDS}). Proceeding with current data.`,
          }, onProgress);
          ErrorReportingService.logInfo(`Tool call limit reached for story generation: ${toolCallRounds.length} rounds`);

          const storyProps: StoryGenerationProps = {
            description,
            datasetPath,
            conversationHistory: finalMessages
          };
          const result = await renderPrompt(StoryGenerationPrompt, storyProps, endpoint, model);
          const finalResponse = await model.sendRequest(result.messages, {}, new vscode.CancellationTokenSource().token);
          return await this.accumulateTextFromStream(finalResponse.stream);
        }

        const options: vscode.LanguageModelChatRequestOptions = {
          justification: 'Generating data story with dataset exploration',
        };

        if (mcpTools.length > 0 && datasetPath) {
          options.tools = mcpTools.slice(0, 128);
          options.toolMode = vscode.LanguageModelChatToolMode.Auto;
        }

        ErrorReportingService.logInfo(`Sending request with ${finalMessages.length} messages`);
        let responseText = '';
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        try {
          const response = await model.sendRequest(finalMessages, options, new vscode.CancellationTokenSource().token);

          for await (const part of response.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
              responseText += part.value;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
              toolCalls.push(part);
            }
          }

          ErrorReportingService.logInfo(`Response received. Text length: ${responseText.length}, Tool calls: ${toolCalls.length}`);
        } catch (sendRequestError) {
          ErrorReportingService.logError(sendRequestError as Error, 'model-send-request-failed');
          throw sendRequestError;
        }

        if (toolCalls.length > CopilotIntegration.MAX_TOOL_CALLS_PER_ROUND) {
          this.addProgressStep(chatProgress, {
            type: 'error',
            content: `Too many tool calls in single round (${toolCalls.length} > ${CopilotIntegration.MAX_TOOL_CALLS_PER_ROUND}). Processing only first ${CopilotIntegration.MAX_TOOL_CALLS_PER_ROUND}.`,
          }, onProgress);
          toolCalls.splice(CopilotIntegration.MAX_TOOL_CALLS_PER_ROUND);
        }

        if (toolCalls.length > 0) {
          totalToolCallCount += toolCalls.length;
          toolCallRounds.push({
            response: responseText,
            toolCalls
          });

          const assistantMessage = vscode.LanguageModelChatMessage.Assistant(responseText);
          finalMessages.push(assistantMessage);

          const toolResults = await this.handleToolCalls(toolCalls, datasetPath, chatProgress, onProgress);
          toolResults.forEach(({ toolCall, result }) => {
            accumulatedToolResults[toolCall.callId] = result;
          });

          for (const { toolCall, result } of toolResults) {
            const toolResultContent = this.formatToolResultContent(result);
            finalMessages.push(vscode.LanguageModelChatMessage.User(`Tool result from ${toolCall.name}: ${toolResultContent}`));
          }

          if (this.shouldTerminateToolCalls(toolResults, toolCallRounds, chatProgress, onProgress)) {
            this.addProgressStep(chatProgress, {
              type: 'user',
              content: 'Sufficient data gathered from tools. Generating data story.',
            }, onProgress);

            const storyProps: StoryGenerationProps = {
              description,
              datasetPath,
              conversationHistory: finalMessages
            };

            const result = await renderPrompt(StoryGenerationPrompt, storyProps, endpoint, model);

            const finalResponse = await model.sendRequest(result.messages, {}, new vscode.CancellationTokenSource().token);
            return await this.accumulateTextFromStream(finalResponse.stream);
          }
          return runWithTools();
        }

        return responseText;
      };

      const finalText = await runWithTools();
      this.addProgressStep(chatProgress, { type: 'assistant', content: finalText }, onProgress);

      ErrorReportingService.logInfo(`Story generation completed - Total rounds: ${toolCallRounds.length}, Total tool calls: ${totalToolCallCount}`);
      ErrorReportingService.logInfo(`Final response length: ${finalText.length}`);

      const parsedStory = this.parseStoryResponse(finalText);
      if (!parsedStory) {
        ErrorReportingService.logInfo('Failed to parse story from response');
        this.addProgressStep(chatProgress, {
          type: 'error',
          content: 'Failed to parse story structure from AI response. The AI may not have followed the expected JSON format.'
        }, onProgress);
        throw new Error('Failed to parse story structure from AI response');
      }

      if (parsedStory && datasetPath) {
        parsedStory.datasetPath = datasetPath;
      }

      ErrorReportingService.logInfo(`Successfully parsed story: "${parsedStory.title}" with ${parsedStory.steps.length} steps`);

      const validatedStory = await this.validateStorySteps(parsedStory, datasetPath, chatProgress, model, onProgress);
      return validatedStory;
    } catch (error) {
      this.addProgressStep(chatProgress, { type: 'error', content: 'Story generation failed', error: String(error) }, onProgress);
      ErrorReportingService.logError(error as Error, 'story-generation-failure');
      vscode.window.showErrorMessage(`Story generation failed: ${error}`);
      return null;
    }
  }

  private async validateStorySteps(
    story: DataStory,
    datasetPath: string,
    chatProgress: ChatProgressStep[],
    model: vscode.LanguageModelChat,
    onProgress?: (step: ChatProgressStep) => void
  ): Promise<DataStory> {
    const availableTools = vscode.lm ? vscode.lm.tools : [];
    const hasQueryDatasetTool = availableTools.some(tool =>
      tool.name.includes('query_dataset') || tool.name.includes('query-dataset')
    );

    if (!hasQueryDatasetTool) {
      this.addProgressStep(chatProgress, {
        type: 'error',
        content: 'Analytics MCP server not connected. Skipping SQL validation. Story steps will be used as-is.'
      }, onProgress);
      ErrorReportingService.logInfo('No query_dataset tool available, skipping validation');
      vscode.window.showWarningMessage('Analytics MCP server not connected. SQL queries will not be validated.');
      return story;
    }

    this.addProgressStep(chatProgress, {
      type: 'user',
      content: `Validating ${story.steps.length} story steps...`
    }, onProgress);

    const validatedSteps = [];
    const failedSteps = [];

    for (let i = 0; i < story.steps.length; i++) {
      const step = story.steps[i];
      this.addProgressStep(chatProgress, {
        type: 'user',
        content: `Validating step ${i + 1}: "${step.title}"`
      }, onProgress);

      try {
        const result = await this.executeSQLWithMCPReaderService(step.sqlQuery, datasetPath, 5);

        this.addProgressStep(chatProgress, {
          type: 'tool_result',
          content: `Step ${i + 1} SQL validation successful`,
          toolName: 'query_dataset'
        }, onProgress);

        validatedSteps.push(step);
        ErrorReportingService.logInfo(`Step ${i + 1} validated successfully`);
      } catch (sqlError) {
        ErrorReportingService.logError(sqlError as Error, `story-step-${i + 1}-validation`);
        this.addProgressStep(chatProgress, {
          type: 'error',
          content: `Step ${i + 1} SQL validation failed: ${sqlError}`,
          error: String(sqlError)
        }, onProgress);

        failedSteps.push({ step, index: i, error: String(sqlError) });
      }
    }

    if (failedSteps.length > 0) {
      this.addProgressStep(chatProgress, {
        type: 'error',
        content: `${failedSteps.length} story steps failed validation. Attempting to fix...`
      }, onProgress);

      const fixedSteps = await this.fixFailedStorySteps(
        story,
        failedSteps,
        datasetPath,
        chatProgress,
        model,
        onProgress
      );

      for (const fixedStep of fixedSteps) {
        if (fixedStep.fixed) {
          validatedSteps.splice(fixedStep.index, 0, fixedStep.step);
        }
      }

      const unfixableCount = failedSteps.length - fixedSteps.filter(s => s.fixed).length;
      if (unfixableCount > 0) {
        this.addProgressStep(chatProgress, {
          type: 'error',
          content: `${unfixableCount} steps could not be fixed and were removed from the story`
        }, onProgress);
      }
    }

    validatedSteps.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (validatedSteps.length === 0) {
      throw new Error('No valid story steps could be generated');
    }

    this.addProgressStep(chatProgress, {
      type: 'user',
      content: `Story validation complete: ${validatedSteps.length} valid steps`
    }, onProgress);

    return {
      ...story,
      steps: validatedSteps
    };
  }

  private async fixFailedStorySteps(
    story: DataStory,
    failedSteps: Array<{ step: any, index: number, error: string }>,
    datasetPath: string,
    chatProgress: ChatProgressStep[],
    model: vscode.LanguageModelChat,
    onProgress?: (step: ChatProgressStep) => void
  ): Promise<Array<{ step: any, index: number, fixed: boolean }>> {
    const maxRetries = 2;
    const fixedSteps = [];

    for (const failedStep of failedSteps) {
      let retryCount = 0;
      let stepFixed = false;

      while (retryCount < maxRetries && !stepFixed) {
        try {
          this.addProgressStep(chatProgress, {
            type: 'user',
            content: `Attempting to fix step ${failedStep.index + 1}, retry ${retryCount + 1}`
          }, onProgress);

          const storyProps: StoryGenerationProps = {
            description: `Fix this SQL query that failed with error: ${failedStep.error}`,
            datasetPath,
            toolResults: []
          };

          const endpoint = { modelMaxPromptTokens: model.maxInputTokens };
          const messages = [
            vscode.LanguageModelChatMessage.User(
              `Fix this SQL query for a data story step. The query failed with error: "${failedStep.error}"
              
              Original step:
              - Title: ${failedStep.step.title}
              - Description: ${failedStep.step.description}
              - Failed SQL: ${failedStep.step.sqlQuery}
              
              Please provide ONLY a corrected SQL query that uses table name 'base' and avoids the error.
              Return only the SQL query, nothing else.`
            )
          ];

          const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
          const fixedSQL = await this.accumulateTextFromStream(response.stream);

          const cleanSQL = fixedSQL.replace(/```sql\n?/, '').replace(/```\n?$/, '').trim();

          await this.executeSQLWithMCPReaderService(cleanSQL, datasetPath, 5);

          failedStep.step.sqlQuery = cleanSQL;
          stepFixed = true;

          this.addProgressStep(chatProgress, {
            type: 'tool_result',
            content: `Successfully fixed step ${failedStep.index + 1}`
          }, onProgress);

        } catch (error) {
          retryCount++;
          this.addProgressStep(chatProgress, {
            type: 'error',
            content: `Fix attempt ${retryCount} failed for step ${failedStep.index + 1}: ${error}`
          }, onProgress);
        }
      }

      fixedSteps.push({
        step: failedStep.step,
        index: failedStep.index,
        fixed: stepFixed
      });
    }

    return fixedSteps;
  }

  async fixJavaScriptCode(
    jsCode: string,
    error: string,
    step: any,
    dataContext: {
      rows: any[],
      columnNames: string[],
      sampleRows: any[],
      rowCount: number,
      columnTypes: Record<string, string>
    },
    selectedModelId?: string,
  ): Promise<string | null> {
    try {
      ErrorReportingService.logInfo('Starting JavaScript code fix attempt');

      const models = await this.getAvailableModels();
      if (!models.length) {
        ErrorReportingService.logInfo('No models available for JavaScript fix');
        return null;
      }
      ErrorReportingService.logInfo(`Available model families: ${models.map(m => m.family).join(', ')}`);

      const model = this.getModel(models, selectedModelId);
      if (!model) {
        ErrorReportingService.logInfo('No valid model found for JavaScript fix');
        return null;
      }

      const dataSummary = this.prepareDataSummary(dataContext);

      const fixPrompt = `Fix this JavaScript visualization code that failed with an error.

ERROR: ${error}

FAILED CODE:
\`\`\`javascript
${jsCode}
\`\`\`

VISUALIZATION CONTEXT:
- Title: ${step.title}
- Description: ${step.description}

DATA CONTEXT:
${dataSummary}

REQUIREMENTS:
1. Fix the JavaScript code to work with the provided data structure
2. Use Plotly.js for visualization (already loaded)
3. Target container ID is 'step-chart-container'
4. The data is available as variables: data (array of rows), Plotly (library), container (container ID)
5. Return ONLY the corrected JavaScript code, no explanations
6. Ensure the code handles the exact column names and data types shown above

Please provide the fixed JavaScript code:`;

      const messages = [
        vscode.LanguageModelChatMessage.User(fixPrompt)
      ];

      ErrorReportingService.logInfo(`Sending fix request to model: ${model.id}`);

      const response = await model.sendRequest(
        messages,
        { justification: 'Fixing failed JavaScript visualization code' },
        new vscode.CancellationTokenSource().token
      );

      const fixedCode = await this.accumulateTextFromStream(response.stream);

      const cleanedCode = this.cleanJavaScriptResponse(fixedCode);

      ErrorReportingService.logInfo(`JavaScript fix attempt completed. Fixed code length: ${cleanedCode.length}`);

      return cleanedCode;

    } catch (error) {
      ErrorReportingService.logError(error as Error, 'javascript-fix-failure');
      return null;
    }
  }

  private prepareDataSummary(dataContext: {
    rows: any[],
    columnNames: string[],
    sampleRows: any[],
    rowCount: number,
    columnTypes: Record<string, string>
  }): string {
    const { rows, columnNames, sampleRows, rowCount, columnTypes } = dataContext;

    let summary = `Data Structure:
- Total rows: ${rowCount}
- Columns: ${columnNames.join(', ')}

Column Types:
${Object.entries(columnTypes).map(([col, type]) => `- ${col}: ${type}`).join('\n')}

Sample Data (first ${Math.min(5, sampleRows.length)} rows):`;

    if (sampleRows.length > 0) {
      summary += '\n' + JSON.stringify(sampleRows, null, 2);
    }

    return summary;
  }

  private cleanJavaScriptResponse(response: string): string {
    let cleaned = response.replace(/```javascript\n?/g, '').replace(/```\n?$/g, '').trim();
    cleaned = cleaned.replace(/^```\s*/g, '').replace(/\s*```$/g, '');
    const codeBlockMatch = cleaned.match(/```[\s\S]*?```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[0].replace(/```\w*\n?/g, '').replace(/```$/g, '').trim();
    }

    return cleaned;
  }

  async fixSQLQuery(
    sqlQuery: string,
    error: string,
    step: any,
    datasetPath: string
  ): Promise<string | null> {
    try {
      ErrorReportingService.logInfo('Starting SQL query fix attempt');

      const models = await this.getAvailableModels();
      if (!models.length) {
        ErrorReportingService.logInfo('No models available for SQL fix');
        return null;
      }

      let model = models.find(m => m.vendor === 'copilot' && m.family.startsWith('gpt-4o'));
      if (!model) {
        model = models[0];
      }

      const fixPrompt = `Fix this SQL query that failed with an error.

ERROR: ${error}

FAILED SQL:
\`\`\`sql
${sqlQuery}
\`\`\`

CONTEXT:
- Title: ${step.title}
- Description: ${step.description}
- Dataset Path: ${datasetPath}
- Target table name should be 'base'

REQUIREMENTS:
1. Fix the SQL query to work with the dataset
2. Use 'base' as the table name (this is required)
3. Return ONLY the corrected SQL query, no explanations
4. Ensure the query is valid SQL syntax
5. Make sure the query addresses the analysis goal: ${step.description}

Please provide the fixed SQL query:`;

      const messages = [
        vscode.LanguageModelChatMessage.User(fixPrompt)
      ];

      ErrorReportingService.logInfo(`Sending SQL fix request to model: ${model.id}`);

      const response = await model.sendRequest(
        messages,
        { justification: 'Fixing failed SQL query for data analysis' },
        new vscode.CancellationTokenSource().token
      );

      const fixedSQL = await this.accumulateTextFromStream(response.stream);

      try {
        await this.executeSQLWithMCPReaderService(fixedSQL, datasetPath, 5);

        ErrorReportingService.logInfo(`SQL fix successful. Fixed query length: ${fixedSQL.length}`);
        return fixedSQL;

      } catch (testError) {
        ErrorReportingService.logError(testError as Error, 'sql-fix-verification-failed');
        return null;
      }

    } catch (error) {
      ErrorReportingService.logError(error as Error, 'sql-fix-failure');
      return null;
    }
  }

  async isLanguageModelAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch (error) {
      ErrorReportingService.logError(error as Error, 'language-model-check');
      return false;
    }
  }

  async executeSQLWithMCPReaderService(sqlQuery: string, datasetPath: string, limit: number = 1000): Promise<{ rows: any[], columnNames: string[] }> {
    try {
      ErrorReportingService.logInfo(`Executing SQL with MCP Reader Service. Dataset: ${datasetPath}, SQL Query: ${sqlQuery}`);

      const availableTools = vscode.lm ? vscode.lm.tools : [];
      const queryDatasetTool = availableTools.find(tool =>
        tool.name.includes('query_dataset') || tool.name.includes('query-dataset')
      );

      if (!queryDatasetTool) {
        throw new Error('No query_dataset tool found. Available tools: ' + availableTools.map(t => t.name).join(', '));
      }

      ErrorReportingService.logInfo(`Using tool: ${queryDatasetTool.name}`);

      const toolResult = await vscode.lm.invokeTool(
        queryDatasetTool.name,
        {
          input: {
            datasets: [
              {
                name: 'Base',
                path: datasetPath,
                sql: sqlQuery
              }
            ],
            limit: limit,
            result_only: true
          },
          toolInvocationToken: undefined,
        },
        new vscode.CancellationTokenSource().token
      );

      let resultData: any = {};
      for (const contentItem of toolResult.content) {
        const typedContent = contentItem as vscode.LanguageModelTextPart;
        let rawData = typedContent.value;
        if (rawData.startsWith('Error') || rawData.includes('error') || rawData.includes('Error')) {
          throw new Error(`MCP tool returned error: ${rawData}`);
        }
        try {
          rawData = rawData.replace(/^Sample data:\s*/, '');
          const data = JSON.parse(rawData);
          if (Array.isArray(data)) {
            resultData = data[0];
          } else {
            resultData = data;
          }
        } catch (parseError) {
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
}
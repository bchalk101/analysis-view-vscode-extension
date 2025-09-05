import * as vscode from 'vscode';
import { ErrorReportingService } from './ValidationService';
import { ChatProgressStep } from './types';
import {
  AnalysisGenerationPrompt,
  RetryPrompt,
  AnalysisGenerationProps,
  RetryPromptProps
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
  constructor() { }

  private addProgressStep(chatProgress: ChatProgressStep[], step: Omit<ChatProgressStep, 'timestamp'>) {
    chatProgress.push({ ...step, timestamp: new Date().toISOString() });
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
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
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

  private getModel(models: vscode.LanguageModelChat[], selectedModelId?: string) {
    if (!models.length) return null;
    if (selectedModelId) return models.find(m => m.id === selectedModelId) || models[0];
    return models[0];
  }

  private async buildPrompt(description: string, datasetPath: string, chatHistory: vscode.LanguageModelChatMessage[], model: vscode.LanguageModelChat, toolCallRounds: any[] = [], toolResults?: Array<{ toolCall: vscode.LanguageModelToolCallPart; result: vscode.LanguageModelToolResult }>) {
    const endpoint = { modelMaxPromptTokens: model.maxInputTokens };

    if (chatHistory.length > 0) {
      const retryProps: RetryPromptProps = {
        description,
        chatHistory
      };
      const { messages } = await renderPrompt(RetryPrompt, retryProps, endpoint, model);
      const prompt = this.extractPromptText(messages);
      return { messages, prompt };
    }

    const analysisProps: AnalysisGenerationProps = {
      description,
      datasetPath,
      toolResults
    };
    const { messages } = await renderPrompt(AnalysisGenerationPrompt, analysisProps, endpoint, model);
    const prompt = this.extractPromptText(messages);
    return { messages, prompt };
  }

  private extractPromptText(messages: vscode.LanguageModelChatMessage[]): string {
    return messages
      .filter(msg => msg.role === vscode.LanguageModelChatMessageRole.User)
      .map(msg => msg.content)
      .join('\n\n');
  }

  private async handleToolCalls(toolCalls: vscode.LanguageModelToolCallPart[], chatProgress: ChatProgressStep[]) {
    const toolResults: Array<{ toolCall: vscode.LanguageModelToolCallPart, result: any }> = [];
    for (const toolCall of toolCalls) {
      try {
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
        });
      } catch (toolError) {
        ErrorReportingService.logError(toolError as Error, 'tool-execution');
        vscode.window.showWarningMessage(`Dataset exploration failed: ${toolError}`);
        this.addProgressStep(chatProgress, {
          type: 'error',
          content: `Tool execution failed`,
          toolName: toolCall.name,
          error: String(toolError)
        });
      }
    }
    return toolResults;
  }

  private async validateSQL(sql: string, datasetPath: string, description: string, chatProgress: ChatProgressStep[], model: vscode.LanguageModelChat) {
    try {
      const result = await vscode.lm.invokeTool(
        'mcp_reader-servic_query_dataset',
        {
          input: {
            datasets: [{ name: 'Base', path: datasetPath, sql }],
            limit: 10,
            result_only: true
          },
          toolInvocationToken: undefined,
        },
        new vscode.CancellationTokenSource().token
      );
      this.addProgressStep(chatProgress, {
        type: 'tool_result',
        content: 'SQL query validation successful',
        toolName: 'mcp_reader-servic_query_dataset',
        toolOutput: this.safeJsonStringify(result).length > 500 ? this.safeJsonStringify(result).substring(0, 500) + '...' : this.safeJsonStringify(result)
      });
      return null;
    } catch (sqlError) {
      this.addProgressStep(chatProgress, {
        type: 'error',
        content: 'SQL query validation failed',
        error: String(sqlError)
      });

      const analysisProps: AnalysisGenerationProps = {
        description,
        isRetry: true,
        failedSql: sql,
        sqlError: String(sqlError)
      };
      const endpoint = { modelMaxPromptTokens: 128000 };
      const { messages } = await renderPrompt(AnalysisGenerationPrompt, analysisProps, endpoint, model);
      const prompt = this.extractPromptText(messages);

      this.addProgressStep(chatProgress, { type: 'user', content: prompt });
      const retryResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
      const retryResponseText = await this.accumulateTextFromStream(retryResponse.stream);
      this.addProgressStep(chatProgress, { type: 'assistant', content: retryResponseText });
      return this.parseResponse(retryResponseText);
    }
  }

  async generateCodeWithLanguageModel(
    description: string,
    datasetPath: string = '',
    selectedModelId?: string,
    chatHistory: vscode.LanguageModelChatMessage[] = []
  ): Promise<GeneratedCodeWithProgress | null> {
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

      if (model.vendor === 'copilot' && model.family.startsWith('o1')) {
        const gpt4Models = await vscode.lm.selectChatModels({
          vendor: 'copilot',
          family: 'gpt-4o'
        });
        if (gpt4Models.length > 0) {
          model = gpt4Models[0];
        }
      }

      const availableTools = vscode.lm ? vscode.lm.tools : [];
      const mcpTools = availableTools.filter(tool => !tool.name.startsWith('copilot'));

      const { messages, prompt } = await this.buildPrompt(description, datasetPath, chatHistory, model);
      this.addProgressStep(chatProgress, { type: 'user', content: prompt });

      const accumulatedToolResults: Record<string, vscode.LanguageModelToolResult> = {};
      const toolCallRounds: any[] = [];
      let finalMessages = messages;

      const runWithTools = async (): Promise<string> => {
        if (!model) {
          throw new Error('No valid model available');
        }

        const options: vscode.LanguageModelChatRequestOptions = {
          justification: 'Generating code analysis with dataset exploration',
        };

        if (mcpTools.length > 0 && datasetPath && chatHistory.length === 0) {
          options.tools = mcpTools.slice(0, 128);
          options.toolMode = vscode.LanguageModelChatToolMode.Auto;
        }

        const response = await model.sendRequest(finalMessages, options, new vscode.CancellationTokenSource().token);

        let responseText = '';
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            responseText += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
            this.addProgressStep(chatProgress, {
              type: 'tool_call',
              content: `Calling tool: ${part.name}`,
              toolName: part.name,
              toolInput: this.safeJsonStringify(part.input)
            });
          }
        }

        ErrorReportingService.logInfo(`Tool calls made: ${toolCalls.length}`);
        ErrorReportingService.logInfo(`Response text length: ${responseText.length}`);

        if (toolCalls.length > 0) {
          toolCallRounds.push({
            response: responseText,
            toolCalls
          });

          const toolResults = await this.handleToolCalls(toolCalls, chatProgress);
          toolResults.forEach(({ toolCall, result }) => {
            accumulatedToolResults[toolCall.callId] = result;
          });

          const analysisProps: AnalysisGenerationProps = {
            description,
            toolResults
          };
          const endpoint = { modelMaxPromptTokens: model.maxInputTokens };
          const result = await renderPrompt(AnalysisGenerationPrompt, analysisProps, endpoint, model);
          finalMessages = result.messages;

          return runWithTools();
        }

        return responseText;
      };

      const finalText = await runWithTools();
      this.addProgressStep(chatProgress, { type: 'assistant', content: finalText });

      const parsedCode = this.parseResponse(finalText);

      const metadata: AnalysisToolUserMetadata = {
        toolCallsMetadata: {
          toolCallRounds,
          toolCallResults: accumulatedToolResults
        }
      };

      if (parsedCode.sql && datasetPath) {
        const retryResult = await this.validateSQL(parsedCode.sql, datasetPath, description, chatProgress, model);
        if (retryResult) {
          return { ...retryResult, chatProgress, metadata };
        }
      }

      return { ...parsedCode, chatProgress, metadata };
    } catch (error) {
      this.addProgressStep(chatProgress, { type: 'error', content: 'Code generation failed', error: String(error) });
      ErrorReportingService.logError(error as Error, 'code-generation-failure');
      vscode.window.showErrorMessage(`Code generation failed: ${error}`);
      return {
        sql: '',
        javascript: '',
        chatProgress,
        metadata: {
          toolCallsMetadata: {
            toolCallRounds: [],
            toolCallResults: {}
          }
        }
      };
    }
  }

  private parseResponse(response: string): GeneratedCode {
    const sqlMatch = response.match(/```sql\n([\s\S]*?)\n```/);
    const jsMatch = response.match(/```javascript\n([\s\S]*?)\n```/);
    return {
      sql: sqlMatch ? sqlMatch[1].trim() : '',
      javascript: jsMatch ? jsMatch[1].trim() : ''
    };
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
}
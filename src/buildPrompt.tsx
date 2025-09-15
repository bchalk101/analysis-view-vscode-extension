
import * as vscode from 'vscode';
import {
	AssistantMessage,
	BasePromptElementProps,
	Chunk,
	PrioritizedList,
	PromptElement,
	PromptElementProps,
	PromptMetadata,
	PromptPiece,
	PromptReference,
	PromptSizing,
	ToolCall,
	ToolMessage,
	UserMessage
} from '@vscode/prompt-tsx';
import { ToolResult } from '@vscode/prompt-tsx/dist/base/promptElements';

export interface ToolCallRound {
	response: string;
	toolCalls: vscode.LanguageModelToolCallPart[];
}

export interface ToolUserProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

export interface AnalysisGenerationProps extends BasePromptElementProps {
	description: string;
	datasetPath?: string;
	isRetry?: boolean;
	failedSql?: string;
	sqlError?: string;
	toolResults?: Array<{ toolCall: vscode.LanguageModelToolCallPart; result: vscode.LanguageModelToolResult }>;
	isStoryMode?: boolean;
}

export interface StoryGenerationProps extends BasePromptElementProps {
	description: string;
	datasetPath: string;
	toolResults?: Array<{ toolCall: vscode.LanguageModelToolCallPart; result: vscode.LanguageModelToolResult }>;
}
export class AnalysisGenerationPrompt extends PromptElement<AnalysisGenerationProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		if (this.props.isRetry && this.props.failedSql && this.props.sqlError) {
			return this.renderSqlRetryPrompt();
		}

		if (this.props.toolResults && this.props.toolResults.length > 0) {
			return this.renderToolResultsPrompt();
		}

		return this.renderMainGenerationPrompt();
	}

	private renderSqlRetryPrompt() {
		return (
			<UserMessage>
				SQL query failed: {this.props.sqlError}. Fix the SQL query and regenerate both SQL and JavaScript.
				<br /><br />
				**FAILED SQL:**<br />
				```sql<br />
				{this.props.failedSql}<br />
				```<br /><br />
				**USER REQUEST:** {this.props.description}<br /><br />
				{this.props.datasetPath && (
					<>**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**<br /></>
				)}
				Generate corrected SQL and JavaScript:
			</UserMessage>
		);
	}

	private renderToolResultsPrompt() {
		const toolResultsSummary = this.props.toolResults!.map(tr => {
			const contentText = this.formatToolResultContent(tr.result);
			return `**${tr.toolCall.name} Results:**\n${contentText}`;
		}).join('\n\n');

		return (
			<UserMessage>
				Based on the dataset exploration results, generate SQL and JavaScript code.
                You may call more tools if needed.<br />
				<br /><br />
				**TOOL RESULTS:**<br />
				{toolResultsSummary}
				<br /><br />
				**REQUIREMENTS:**<br />
				- SQL query using table name 'base'<br />
				- JavaScript with Plotly.newPlot() call<br />
				- Data format: {"{"}"column": [val1, val2], "column2": [val3, val4]{"}"}<br />
				- Use real column names from dataset<br /><br />
				{this.props.datasetPath && (
					<>**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**<br /></>
				)}
				**USER REQUEST:** {this.props.description}
				<br /><br />
                If you need to generate new SQL or JavaScript, please do so.<br />
				Format response as:<br />
				```sql<br />
				-- SQL query here<br />
				```<br /><br />
				```javascript<br />
				if (!data || Object.keys(data).length === 0) {"{"}<br />
				&nbsp;&nbsp;&nbsp;&nbsp;console.error('No data available');<br />
				&nbsp;&nbsp;&nbsp;&nbsp;return;<br />
				{"}"}<br /><br />
				const plotData = [{"{"}
				&nbsp;&nbsp;type: 'bar',
				&nbsp;&nbsp;x: data.column_name,
				&nbsp;&nbsp;y: data.other_column
				{"}"}];<br /><br />
				Plotly.newPlot('visualization-container', plotData, layout);<br />
				```
			</UserMessage>
		);
	}

	private renderMainGenerationPrompt() {
		const explorationInstructions = this.props.datasetPath
			? `🔍 **STEP 1: MANDATORY DATASET EXPLORATION**
You MUST first explore the actual dataset using the available MCP reader service tools.

**CRITICAL: The dataset path you must use is: "${this.props.datasetPath}"**

Use this EXACT path in all tool calls.
DO NOT generate any visualization code until you have explored the real dataset structure!`
			: `📊 **Using Sample Data**: Generate code for sample computer vision dataset with typical CV columns.`;

		return (
            <>
            <UserMessage>
                Instructions: <br />
					- The user will ask a question, or ask you to perform a task, and it may
					require lots of research to answer correctly. There is a selection of
					tools that let you perform actions or retrieve helpful context to answer
					the user's question. <br />
					- If you aren't sure which tool is relevant, you can call multiple
					tools. You can call tools repeatedly to take actions or gather as much
					context as needed until you have completed the task fully. Don't give up
					unless you are sure the request cannot be fulfilled with the tools you
					have. <br />
					- Don't make assumptions about the situation- gather context first, then
					perform the task or answer the question. <br />
					- Don't ask the user for confirmation to use tools, just use them.
            </UserMessage>
			<UserMessage>
				Create custom Plotly chart configuration(s) for analyzing a computer vision dataset.
				<br /><br />
				**USER REQUEST:** {this.props.description || '[Describe your analysis needs]'}
				<br /><br />
				**DATASET INFO:**<br />
				- Path: {this.props.datasetPath || 'No dataset path available'}
				<br /><br />
				**CRITICAL INSTRUCTIONS:**<br />
				{explorationInstructions}
				<br /><br />
				<DatasetAnalysisInstructions />
				<br />
				<TechnicalRequirements />
				<br />
				<SqlOptimization />
				<br />
				<ResponseFormat />
			</UserMessage>
            </>
		);
	}

	private formatToolResultContent(result: vscode.LanguageModelToolResult) {
		return result.content.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
	}
}

export class StoryGenerationPrompt extends PromptElement<StoryGenerationProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		if (this.props.toolResults && this.props.toolResults.length > 0) {
			return this.renderWithToolResults();
		}
		return this.renderInitialStoryPrompt();
	}

	private renderWithToolResults() {
		const toolResultsSummary = this.props.toolResults!.map(tr => {
			const contentText = this.formatToolResultContent(tr.result);
			return `**${tr.toolCall.name} Results:**\n${contentText}`;
		}).join('\n\n');

		return (
			<UserMessage>
				Based on the dataset exploration results, generate a comprehensive data story with multiple visualization steps.
				You may call more tools if needed for deeper analysis.<br />
				<br /><br />
				**TOOL RESULTS:**<br />
				{toolResultsSummary}
				<br /><br />
				**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**<br />
				**USER REQUEST:** {this.props.description}
				<br /><br />
				<StoryInstructions />
				<br />
				<StoryResponseFormat />
			</UserMessage>
		);
	}

	private renderInitialStoryPrompt() {
		return (
			<>
				<UserMessage>
					Instructions: <br />
					- The user will ask a question, or ask you to perform a task, and it may
					require lots of research to answer correctly. There is a selection of
					tools that let you perform actions or retrieve helpful context to answer
					the user's question. <br />
					- If you aren't sure which tool is relevant, you can call multiple
					tools. You can call tools repeatedly to take actions or gather as much
					context as needed until you have completed the task fully. Don't give up
					unless you are sure the request cannot be fulfilled with the tools you
					have. <br />
					- Don't make assumptions about the situation- gather context first, then
					perform the task or answer the question. <br />
					- Don't ask the user for confirmation to use tools, just use them.
				</UserMessage>
				<UserMessage>
					Create a comprehensive data story for analyzing a computer vision dataset.
					Generate multiple visualization steps that tell a compelling story about the data.
					<br /><br />
					**USER REQUEST:** {this.props.description || '[Describe your analysis needs]'}
					<br /><br />
					**DATASET INFO:**<br />
					- Path: {this.props.datasetPath}
					<br /><br />
					**CRITICAL INSTRUCTIONS:**<br />
					🔍 **STEP 1: MANDATORY DATASET EXPLORATION**
					You MUST first explore the actual dataset using the available MCP reader service tools.
					
					**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**
					
					Use this EXACT path in all tool calls.
					DO NOT generate any visualization code until you have explored the real dataset structure!
					<br /><br />
					<StoryInstructions />
					<br />
					<StoryResponseFormat />
				</UserMessage>
			</>
		);
	}

	private formatToolResultContent(result: vscode.LanguageModelToolResult) {
		return result.content.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
	}
}

export interface RetryPromptProps extends BasePromptElementProps {
	description: string;
	chatHistory: vscode.LanguageModelChatMessage[];
}

export class RetryPrompt extends PromptElement<RetryPromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		return (
			<>
				{this.props.chatHistory.map((message, index) => (
					<Chunk>
						{message.role === vscode.LanguageModelChatMessageRole.User ? (
							<UserMessage>{message.content || ''}</UserMessage>
						) : (
							<AssistantMessage>{message.content || ''}</AssistantMessage>
						)}
					</Chunk>
				))}
				<UserMessage>
					Fix the previous code. Generate both SQL and JavaScript.
					<br /><br />
					**REQUIREMENTS:**<br />
					- Update SQL query if needed<br />
					- Fix JavaScript visualization code<br />
					- Format response with both ```sql and ```javascript blocks<br />
					- Ensure Plotly.newPlot() is called<br /><br />
					**USER REQUEST:** {this.props.description}
				</UserMessage>
			</>
		);
	}
}

interface HistoryFromArrayProps extends BasePromptElementProps {
	chatHistory: vscode.ChatRequestTurn[];
}

class HistoryFromArray extends PromptElement<HistoryFromArrayProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		return (
			<PrioritizedList priority={10} descending={false}>
				{this.props.chatHistory.map((turn, index) => (
					<UserMessage>{turn.prompt}</UserMessage>
				))}
			</PrioritizedList>
		);
	}
}

class DatasetAnalysisInstructions extends PromptElement {
	render() {
		return (
			<>
				**OUTPUTS REQUIRED:**<br />
				After exploring the dataset (if path provided), return:<br />
				- A SQL query for data retrieval based on the ACTUAL dataset structure - the table name for the query is Base ie "FROM base"<br />
				- JavaScript code with Plotly chart configuration using the REAL column names<br /><br />
				**COMPREHENSIVE ANALYSIS APPROACH:**<br />
				1. **Dataset Exploration** (use tools if dataset path provided):<br />
				&nbsp;&nbsp;&nbsp;- mcp_reader-servic_get_dataset_metadata: Get schema and metadata for a dataset<br />
				&nbsp;&nbsp;&nbsp;- mcp_reader-servic_query_dataset: Query dataset with filtering, joins, and ordering<br />
				&nbsp;&nbsp;&nbsp;- mcp_reader-servic_count_dataset: Count rows in datasets with optional filtering<br /><br />
				2. **VISUALIZATIONS**:<br />
				&nbsp;&nbsp;&nbsp;- Think comprehensively about what would best answer the user's question<br />
				&nbsp;&nbsp;&nbsp;- Consider different perspectives and complementary analyses<br />
				&nbsp;&nbsp;&nbsp;- Use subplots for dashboard-style presentations<br />
				&nbsp;&nbsp;&nbsp;- Display multiple plots if this will provide more insights - max 4 plots<br />
				&nbsp;&nbsp;&nbsp;- Always use the data that will be returned by the SQL query, don't include any hardcoded values<br /><br />
				<CommonCvPatterns />
			</>
		);
	}
}

class CommonCvPatterns extends PromptElement {
	render() {
		return (
			<>
				**COMMON CV DATASET PATTERNS:**<br /><br />
				**Class Distribution Analysis:**<br />
				- Bar charts showing class frequencies<br />
				- Pie charts and sunburst for class proportions<br />
				- Per-split (train/val/test) distributions<br />
				- Imbalanced class detection<br />
				- Multi-label co-occurrence matrices<br /><br />
				**Annotation Quality Analysis:**<br />
				- Bounding box size distributions<br />
				- Aspect ratio analysis<br />
				- Objects per image statistics<br />
				- Confidence score distributions<br />
				- Edge case detection<br /><br />
				**Model Performance Analysis:**<br />
				- Tables of precision/recall/F1 scores<br />
				- Precision-recall curves<br />
				- Per-class performance metrics<br />
				- Error analysis visualizations<br /><br />
				**Dataset Statistics:**<br />
				- Image dimension distributions<br />
				- File size analysis<br />
				- Temporal/geographic analysis<br />
				- Train/val/test split statistics<br />
			</>
		);
	}
}

class TechnicalRequirements extends PromptElement {
	render() {
		return (
			<>
				**TECHNICAL REQUIREMENTS:**<br />
				- JavaScript should create a Plotly chart and render it to 'visualization-container'<br />
				- Data format: {"{"}"column1": [1,2,3], "column2": [4,5,6]{"}"} - access with data.column_name<br />
				- Handle BigInt conversion with appropriate casting<br />
				- **MULTIPLE PLOTS SUPPORT**: Plotly.js supports multiple subplots in a single visualization:<br />
				&nbsp;&nbsp;&nbsp;- Use subplot references like 'x1', 'y1', 'x2', 'y2' for different plots<br />
				&nbsp;&nbsp;&nbsp;- Set xaxis/yaxis properties for each trace: {"{"} xaxis: 'x1', yaxis: 'y1' {"}"}<br />
				&nbsp;&nbsp;&nbsp;- Configure layout with grid: {"{"} rows: N, columns: M, pattern: 'independent' {"}"}<br />
				&nbsp;&nbsp;&nbsp;- Define multiple axis configurations: xaxis, xaxis2, yaxis, yaxis2, etc.<br />
				&nbsp;&nbsp;&nbsp;- Example: 2x2 grid uses xaxis/yaxis, xaxis2/yaxis2, xaxis3/yaxis3, xaxis4/yaxis4<br />
				- Use proper height (400px per row minimum) and don't do more than 4 plots total<br />
				- Enable resizing of plots, and make sure titles are appropriately placed so as not to block the chart<br />
				- NEVER use import statements or require() - Plotly is already loaded globally<br />
				- Use only vanilla JavaScript with the global Plotly object<br />
				- Do not use any ES6 modules, imports, or external dependencies<br />
			</>
		);
	}
}

class SqlOptimization extends PromptElement {
	render() {
		return (
			<>
				**SQL OPTIMIZATION:**<br />
				- Provide ONE unified SQL query that returns all necessary data<br />
				- Use UNION ALL to combine different analysis aspects<br />
				- Use CTEs for complex logic organization<br />
				- Always use aggregation functions rather than selecting raw data<br />
				- Add 'analysis_type' column to distinguish different parts for JavaScript filtering<br />
				- The query engine is based on DataFusion with extended functions available<br />
				- When writing the SQL the base table name is 'base', ie SELECT * FROM base WHERE ...<br />
			</>
		);
	}
}

class ResponseFormat extends PromptElement {
	render() {
		return (
			<>
				Please format your response exactly like this:<br /><br />
				```sql<br />
				-- Comprehensive query with UNION ALL pattern<br />
				WITH base_stats AS (<br />
				&nbsp;&nbsp;SELECT column1, column2, COUNT(*) as count<br />
				&nbsp;&nbsp;FROM base<br />
				&nbsp;&nbsp;GROUP BY column1, column2<br />
				)<br />
				SELECT 'analysis_type' as type, column1, column2, count<br />
				FROM base_stats<br />
				UNION ALL<br />
				SELECT 'other_analysis' as type, column1, column2, count<br />
				FROM base_stats<br />
				ORDER BY type, column1<br />
				LIMIT 5000;<br />
				```<br /><br />
				```javascript<br />
				if (!data || Object.keys(data).length === 0) {"{"}<br />
				&nbsp;&nbsp;&nbsp;&nbsp;console.error('No data available for visualization');<br />
				&nbsp;&nbsp;&nbsp;&nbsp;return;<br />
				{"}"}<br /><br />
				// Example: Multiple plots in subplots<br />
				const plotData = [<br />
				&nbsp;&nbsp;{"{"}<br />
				&nbsp;&nbsp;&nbsp;&nbsp;type: 'bar',<br />
				&nbsp;&nbsp;&nbsp;&nbsp;x: data.column1.filter((_, i) =&gt; data.analysis_type[i] === 'class_dist'),<br />
				&nbsp;&nbsp;&nbsp;&nbsp;y: data.count.filter((_, i) =&gt; data.analysis_type[i] === 'class_dist'),<br />
				&nbsp;&nbsp;&nbsp;&nbsp;name: 'Class Distribution',<br />
				&nbsp;&nbsp;&nbsp;&nbsp;xaxis: 'x1', yaxis: 'y1'<br />
				&nbsp;&nbsp;{"}"},<br />
				&nbsp;&nbsp;{"{"}<br />
				&nbsp;&nbsp;&nbsp;&nbsp;type: 'scatter',<br />
				&nbsp;&nbsp;&nbsp;&nbsp;x: data.column2.filter((_, i) =&gt; data.analysis_type[i] === 'performance'),<br />
				&nbsp;&nbsp;&nbsp;&nbsp;y: data.score.filter((_, i) =&gt; data.analysis_type[i] === 'performance'),<br />
				&nbsp;&nbsp;&nbsp;&nbsp;name: 'Performance Metrics',<br />
				&nbsp;&nbsp;&nbsp;&nbsp;xaxis: 'x2', yaxis: 'y2'<br />
				&nbsp;&nbsp;{"}"}<br />
				];<br /><br />
				const layout = {"{"}<br />
				&nbsp;&nbsp;title: {"{"} text: 'Analysis Dashboard' {"}"},<br />
				&nbsp;&nbsp;height: 800,<br />
				&nbsp;&nbsp;grid: {"{"} rows: 2, columns: 1, pattern: 'independent' {"}"},<br />
				&nbsp;&nbsp;xaxis: {"{"} title: 'Classes', anchor: 'y1' {"}"},<br />
				&nbsp;&nbsp;yaxis: {"{"} title: 'Count', anchor: 'x1' {"}"},<br />
				&nbsp;&nbsp;xaxis2: {"{"} title: 'Metric Type', anchor: 'y2' {"}"},<br />
				&nbsp;&nbsp;yaxis2: {"{"} title: 'Score', anchor: 'x2' {"}"}<br />
				{"}"};<br /><br />
				Plotly.newPlot('visualization-container', plotData, layout);<br />
				```
			</>
		);
	}
}

interface ToolCallsProps extends BasePromptElementProps {
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
}

const dummyCancellationToken: vscode.CancellationToken = new vscode.CancellationTokenSource().token;

/**
 * Render a set of tool calls, which look like an AssistantMessage with a set of tool calls followed by the associated UserMessages containing results.
 */
class ToolCalls extends PromptElement<ToolCallsProps, void> {
	async render(_state: void, _sizing: PromptSizing) {
		if (!this.props.toolCallRounds.length) {
			return undefined;
		}

		// Note- for the copilot models, the final prompt must end with a non-tool-result UserMessage
		return <>
			{this.props.toolCallRounds.map(round => this.renderOneToolCallRound(round))}
			<UserMessage>Above is the result of calling one or more tools. The user cannot see the results, so you should explain them to the user if referencing them in your answer.</UserMessage>
		</>;
	}

	private renderOneToolCallRound(round: ToolCallRound) {
		const assistantToolCalls: ToolCall[] = round.toolCalls.map(tc => ({ type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input) }, id: tc.callId }));
		return (
			<Chunk>
				<AssistantMessage toolCalls={assistantToolCalls}>{round.response}</AssistantMessage>
				{round.toolCalls.map(toolCall =>
					<ToolResultElement toolCall={toolCall} toolInvocationToken={this.props.toolInvocationToken} toolCallResult={this.props.toolCallResults[toolCall.callId]} />)}
			</Chunk>);
	}
}

interface ToolResultElementProps extends BasePromptElementProps {
	toolCall: vscode.LanguageModelToolCallPart;
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
	toolCallResult: vscode.LanguageModelToolResult | undefined;
}

class ToolResultElement extends PromptElement<ToolResultElementProps, void> {
	async render(state: void, sizing: PromptSizing): Promise<PromptPiece | undefined> {
		const tool = vscode.lm.tools.find(t => t.name === this.props.toolCall.name);
		if (!tool) {
			console.error(`Tool not found: ${this.props.toolCall.name}`);
			return <ToolMessage toolCallId={this.props.toolCall.callId}>Tool not found</ToolMessage>;
		}

		const tokenizationOptions: vscode.LanguageModelToolTokenizationOptions = {
			tokenBudget: sizing.tokenBudget,
			countTokens: async (content: string) => sizing.countTokens(content),
		};

		const toolResult = this.props.toolCallResult ??
			await vscode.lm.invokeTool(this.props.toolCall.name, { input: this.props.toolCall.input, toolInvocationToken: this.props.toolInvocationToken, tokenizationOptions }, dummyCancellationToken);

		return (
			<ToolMessage toolCallId={this.props.toolCall.callId}>
				<meta value={new ToolResultMetadata(this.props.toolCall.callId, toolResult)}></meta>
				<ToolResult data={toolResult} />
			</ToolMessage>
		);
	}
}

export class ToolResultMetadata extends PromptMetadata {
	constructor(
		public toolCallId: string,
		public result: vscode.LanguageModelToolResult,
	) {
		super();
	}
}

interface HistoryProps extends BasePromptElementProps {
	priority: number;
	context: vscode.ChatContext;
}
export interface TsxToolUserMetadata {
	toolCallsMetadata: ToolCallsMetadata;
}

export interface ToolCallsMetadata {
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

function isTsxToolUserMetadata(obj: unknown): obj is TsxToolUserMetadata {
	return !!obj &&
		!!(obj as TsxToolUserMetadata).toolCallsMetadata &&
		Array.isArray((obj as TsxToolUserMetadata).toolCallsMetadata.toolCallRounds);
}


class History extends PromptElement<HistoryProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		return (
			<PrioritizedList priority={this.props.priority} descending={false}>
				{this.props.context.history.map((message) => {
					if (message instanceof vscode.ChatRequestTurn) {
						return (
							<>
								{<PromptReferences references={message.references} excludeReferences={true} />}
								<UserMessage>{message.prompt}</UserMessage>
							</>
						);
					} else if (message instanceof vscode.ChatResponseTurn) {
						const metadata = message.result.metadata;
						if (isTsxToolUserMetadata(metadata) && metadata.toolCallsMetadata.toolCallRounds.length > 0) {
							return <ToolCalls toolCallResults={metadata.toolCallsMetadata.toolCallResults} toolCallRounds={metadata.toolCallsMetadata.toolCallRounds} toolInvocationToken={undefined} />;
						}

						return <AssistantMessage>{chatResponseToString(message)}</AssistantMessage>;
					}
				})}
			</PrioritizedList>
		);
	}
}

function chatResponseToString(response: vscode.ChatResponseTurn): string {
	return response.response
		.map((r) => {
			if (r instanceof vscode.ChatResponseMarkdownPart) {
				return r.value.value;
			} else if (r instanceof vscode.ChatResponseAnchorPart) {
				if (r.value instanceof vscode.Uri) {
					return r.value.fsPath;
				} else {
					return r.value.uri.fsPath;
				}
			}

			return '';
		})
		.join('');
}

interface PromptReferencesProps extends BasePromptElementProps {
	references: ReadonlyArray<vscode.ChatPromptReference>;
	excludeReferences?: boolean;
}

class PromptReferences extends PromptElement<PromptReferencesProps, void> {
	render(_state: void, _sizing: PromptSizing): PromptPiece {
		return (
			<UserMessage>
				{this.props.references.map(ref => (
					<PromptReferenceElement ref={ref} excludeReferences={this.props.excludeReferences} />
				))}
			</UserMessage>
		);
	}
}

interface PromptReferenceProps extends BasePromptElementProps {
	ref: vscode.ChatPromptReference;
	excludeReferences?: boolean;
}

class PromptReferenceElement extends PromptElement<PromptReferenceProps> {
	async render(_state: void, _sizing: PromptSizing): Promise<PromptPiece | undefined> {
		const value = this.props.ref.value;
		if (value instanceof vscode.Uri) {
			const fileContents = (await vscode.workspace.fs.readFile(value)).toString();
			return (
				<Tag name="context">
					{!this.props.excludeReferences && <references value={[new PromptReference(value)]} />}
					{value.fsPath}:<br />
					``` <br />
					{fileContents}<br />
					```<br />
				</Tag>
			);
		} else if (value instanceof vscode.Location) {
			const rangeText = (await vscode.workspace.openTextDocument(value.uri)).getText(value.range);
			return (
				<Tag name="context">
					{!this.props.excludeReferences && <references value={[new PromptReference(value)]} />}
					{value.uri.fsPath}:{value.range.start.line + 1}-$<br />
					{value.range.end.line + 1}: <br />
					```<br />
					{rangeText}<br />
					```
				</Tag>
			);
		} else if (typeof value === 'string') {
			return <Tag name="context">{value}</Tag>;
		}
	}
}

type TagProps = PromptElementProps<{
	name: string;
}>;

class Tag extends PromptElement<TagProps> {
	private static readonly _regex = /^[a-zA-Z_][\w.-]*$/;

	render() {
		const { name } = this.props;

		if (!Tag._regex.test(name)) {
			throw new Error(`Invalid tag name: ${this.props.name}`);
		}

		return (
			<>
				{'<' + name + '>'}<br />
				<>
					{this.props.children}<br />
				</>
				{'</' + name + '>'}<br />
			</>
		);
	}
}

class StoryInstructions extends PromptElement {
	render() {
		return (
			<>
				**DATA STORY REQUIREMENTS:**<br />
				Generate a comprehensive data story with 3-5 visualization steps that progressively reveal deep insights about the dataset.<br /><br />
				
				**STORY STRUCTURE:**<br />
				1. **Overview Step**: Start with a comprehensive summary showing multiple key metrics and distributions<br />
				2. **Deep Dive Steps**: 2-3 detailed analyses exploring specific patterns, relationships, and anomalies<br />
				3. **Insights Step**: End with actionable insights backed by concrete data points and statistics<br /><br />
				
				**EACH STEP MUST BE COMPREHENSIVE:**<br />
				- **Rich Data Context**: Include multiple data points, percentages, counts, and statistical measures<br />
				- **Detailed Insights**: Back up observations with specific numbers, trends, and statistical evidence<br />
				- **Visual Completeness**: Ensure charts show enough data to be meaningful (not just 5-10 points)<br />
				- **Comparative Analysis**: Where relevant, show comparisons, ratios, and relative relationships<br />
				- **Statistical Depth**: Include measures like totals, averages, percentages, top/bottom performers<br /><br />
				
				**ENHANCED VISUALIZATION REQUIREMENTS:**<br />
				- **Data Volume**: Show at least 20-50 data points where meaningful (use appropriate LIMIT)<br />
				- **Multiple Metrics**: Include secondary metrics, percentages, or derived calculations<br />
				- **Rich Labels**: Add data labels, percentages, or values directly on charts<br />
				- **Context Information**: Include totals, averages, or other contextual statistics<br />
				- **Detailed Titles**: Use descriptive titles that include key statistics or findings<br />
				- **Comprehensive Legends**: Ensure all chart elements are clearly labeled<br /><br />
				
				**STORY FLOW GUIDELINES:**<br />
				- Each step should build upon previous findings with concrete data references<br />
				- Progressive disclosure: start broad with comprehensive overview, then focus on specific insights<br />
				- Include variety in visualization types optimized for the data being shown<br />
				- Connect insights across steps with specific data points and statistical evidence<br />
				- End with actionable recommendations supported by the data analysis<br /><br />
				
				<CommonCvPatterns />
			</>
		);
	}
}

class StoryResponseFormat extends PromptElement {
	render() {
		return (
			<>
				**CRITICAL: RESPONSE MUST BE VALID JSON**<br />
				Your entire response must be a single JSON object in a code block. Do not include any explanatory text before or after the JSON.<br /><br />
				
				Format your response exactly like this:<br /><br />
				
				```json<br />
				{"{"}
				&nbsp;&nbsp;"title": "Your Story Title Here",<br />
				&nbsp;&nbsp;"description": "Brief description of the overall story",<br />
				&nbsp;&nbsp;"steps": [<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"{"}
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "step-1",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "First Step Title",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "What this visualization shows",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"insight": "Key insight from this step",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"visualizationType": "bar",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"sqlQuery": "SELECT column1, COUNT(*) as count FROM base GROUP BY column1 ORDER BY count DESC LIMIT 20",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"jsCode": "if (!data || Object.keys(data).length === 0) {'{'}console.error('No data'); return;{'}'} const total = data.count.reduce((a,b) =&gt; a+b, 0); const plotData = [{'{'}type: 'bar', x: data.column1, y: data.count, name: 'Distribution', text: data.count.map((v,i) =&gt; v + ' (' + Math.round(v/total*100) + '%)'), textposition: 'outside'{'}'}]; const layout = [{'{'}title: 'Distribution Overview: ' + total + ' Total Records', xaxis: {'{'}title: 'Categories'{'}'}, yaxis: {'{'}title: 'Count'{'}'}, showlegend: true, height: 500{'}'}]; Plotly.newPlot('visualization-container', plotData, layout);",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"order": 1<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"}"},<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"{"}
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "step-2",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "Second Step Title",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "What this analysis reveals",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"insight": "Another important finding",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"visualizationType": "scatter",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"sqlQuery": "SELECT x_column, y_column FROM base WHERE condition LIMIT 1000",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"jsCode": "if (!data || Object.keys(data).length === 0) {'{'}console.error('No data'); return;{'}'} const correlation = calculateCorrelation(data.x_column, data.y_column); const plotData = [{'{'}type: 'scatter', x: data.x_column, y: data.y_column, mode: 'markers', name: 'Data Points (' + data.x_column.length + ' records)', marker: {'{'}size: 8, opacity: 0.6{'}'}{'}'}]; const layout = {'{'}title: 'Relationship Analysis (Correlation: ' + correlation.toFixed(3) + ')', xaxis: {'{'}title: 'X Values'{'}'}, yaxis: {'{'}title: 'Y Values'{'}'}, annotations: [{'{'}text: 'Sample: ' + data.x_column.length + ' records', x: 0.02, y: 0.98, xref: 'paper', yref: 'paper', showarrow: false{'}'}], height: 500{'}'}; function calculateCorrelation(x, y) {'{'}const n = x.length; const sumX = x.reduce((a, b) =&gt; a + b); const sumY = y.reduce((a, b) =&gt; a + b); const sumXY = x.reduce((sum, xi, i) =&gt; sum + xi * y[i], 0); const sumX2 = x.reduce((sum, xi) =&gt; sum + xi * xi, 0); const sumY2 = y.reduce((sum, yi) =&gt; sum + yi * yi, 0); return (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));{'}'} Plotly.newPlot('visualization-container', plotData, layout);",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"order": 2<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"}"}<br />
				&nbsp;&nbsp;]<br />
				{"}"}<br />
				```<br /><br />
				
				**CRITICAL REQUIREMENTS:**<br />
				- ONLY output the JSON code block - no explanatory text<br />
				- Each step MUST have: title, description, insight, visualizationType, sqlQuery, jsCode<br />
				- **COMPREHENSIVE DATA**: SQL queries should return sufficient data (20-100 rows where meaningful)<br />
				- **RICH INSIGHTS**: Descriptions and insights must include specific numbers, percentages, and statistical findings<br />
				- **ENHANCED VISUALS**: JavaScript must include data labels, totals, percentages, correlations, or other calculated metrics<br />
				- **SQL SAFETY**: Only use simple aggregations, avoid complex array/object operations, nested queries, and field indexing<br />
				- **SQL DEPTH**: Use COUNT, SUM, AVG, GROUP BY, ORDER BY with appropriate LIMIT (50-100 for distributions, 1000+ for scatterplots)<br />
				- **VISUAL ENHANCEMENTS**: Include annotations, data labels, statistical measures, totals, and contextual information<br />
				- **HEIGHT SPECIFICATION**: Always set chart height to 500+ pixels for better visibility<br />
				- All strings must be properly escaped in the JSON<br />
				- Generate 3-5 steps total with each step being data-rich and comprehensive<br />
				- Test your SQL logic mentally - ensure it uses only basic column operations<br />
			</>
		);
	}
}
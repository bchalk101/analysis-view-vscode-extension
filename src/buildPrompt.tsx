
import * as vscode from 'vscode';
import {
	AssistantMessage,
	BasePromptElementProps,
	PrioritizedList,
	PromptElement,
	PromptMetadata,
	ToolResult,
	UserMessage
} from '@vscode/prompt-tsx';

export interface ToolCallRound {
	response: string;
	toolCalls: vscode.LanguageModelToolCallPart[];
}

export interface StoryGenerationProps extends BasePromptElementProps {
	description: string;
	datasetPath: string;
	toolResults?: Array<{ toolCall: vscode.LanguageModelToolCallPart; result: vscode.LanguageModelToolResult }>;
	conversationHistory?: vscode.LanguageModelChatMessage[];
}

export class StoryGenerationPrompt extends PromptElement<StoryGenerationProps, void> {
	render() {
		if ((this.props.conversationHistory && this.props.conversationHistory.length > 0) ||
		    (this.props.toolResults && this.props.toolResults.length > 0)) {
			return this.renderWithContext();
		}
		return this.renderInitialStoryPrompt();
	}

	private renderWithContext() {
		const hasHistory = this.props.conversationHistory && this.props.conversationHistory.length > 0;
		const hasToolResults = this.props.toolResults && this.props.toolResults.length > 0;

		let olderHistory: vscode.LanguageModelChatMessage[] = [];
		let recentHistory: vscode.LanguageModelChatMessage[] = [];

		if (hasHistory) {
			const history = this.props.conversationHistory!;
			const recentCount = Math.min(4, history.length);
			olderHistory = history.slice(0, -recentCount);
			recentHistory = history.slice(-recentCount);
		}

		return (
			<>
				{olderHistory.length > 0 && (
					<PrioritizedList priority={30} descending={false} flexGrow={1}>
						{olderHistory.slice(-6).map((msg, index) => this.renderHistoryMessage(msg, index))}
					</PrioritizedList>
				)}

				{hasToolResults && (
					<PrioritizedList priority={70} descending={false}>
						{this.props.toolResults!.map((tr) => (
							<ToolResult data={tr.result} priority={70} flexGrow={2} />
						))}
					</PrioritizedList>
				)}

				{recentHistory.length > 0 && (
					<PrioritizedList priority={80} descending={false} flexBasis={2}>
						{recentHistory.map((msg, index) => this.renderHistoryMessage(msg, index + olderHistory.length))}
					</PrioritizedList>
				)}

				<UserMessage priority={90} flexBasis={1}>
					Based on the {hasHistory ? 'conversation above' : 'dataset exploration results above'}, generate a comprehensive data story with multiple visualization steps.
					You may call more tools if needed for deeper analysis.<br />
					<br />
					**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**<br />
				</UserMessage>
			</>
		);
	}

	private renderHistoryMessage(message: vscode.LanguageModelChatMessage, index: number) {
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			return (
				<UserMessage>
					{this.extractContentAsString(message.content)}
				</UserMessage>
			);
		} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			return (
				<AssistantMessage>
					{this.extractContentAsString(message.content)}
				</AssistantMessage>
			);
		}
		return null;
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
			}
		}
		return String(content || '');
	}

	private renderInitialStoryPrompt() {
		return (
			<>
				<UserMessage priority={100}>
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
				<UserMessage priority={90}>
					Create a comprehensive data story for analyzing a dataset.
					Generate multiple visualization steps that tell a compelling story about the data.
					<br /><br />
					**USER REQUEST:** {this.props.description || '[Describe your analysis needs]'}
					<br /><br />
					**DATASET INFO:**<br />
					- Path: {this.props.datasetPath}
					<br /><br />
					**CRITICAL INSTRUCTIONS:**<br />
					🔍 **STEP 1: MANDATORY DATASET EXPLORATION**
					You MUST first explore the actual dataset using the available tools.

					**CRITICAL: The dataset path you must use is: "{this.props.datasetPath}"**

					Use this EXACT path in all tool calls.
					DO NOT generate any visualization code until you have explored the real dataset structure!
					<br /><br />
					<StoryInstructions priority={100} />
					<br />
					<StoryResponseFormat priority={100} />
				</UserMessage>
			</>
		);
	}

	private formatToolResultContent(result: vscode.LanguageModelToolResult) {
		return result.content.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
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
				- ALWAYS add responsive configuration to layout: responsive: true, autosize: true<br />
				- NEVER use import statements or require() - Plotly is already loaded globally<br />
				- Use only vanilla JavaScript with the global Plotly object<br />
				- Do not use any ES6 modules, imports, or external dependencies<br />
			</>
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


export interface ToolCallsMetadata {
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
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

class StoryInstructions extends PromptElement {
	render() {
		return (
			<>
				**DATA STORY REQUIREMENTS:**<br />
				Generate a comprehensive data story with 3-5 visualization steps that progressively reveal deep insights about the dataset.<br /><br />

				**STORY STRUCTURE:**<br />
				1. **Overview Step**: Start with a comprehensive summary showing multiple key metrics and distributions<br />
				2. **Deep Dive Steps**: 2-3 detailed analyses exploring specific patterns, relationships, and anomalies, make sure to use actual data<br />
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
				<SqlOptimization />
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
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"jsCode": "if (!data || Object.keys(data).length === 0) {'{'}console.error('No data'); return;{'}'} const total = data.count.reduce((a,b) =&gt; a+b, 0); const plotData = [{'{'}type: 'bar', x: data.column1, y: data.count, name: 'Distribution', text: data.count.map((v,i) =&gt; v + ' (' + Math.round(v/total*100) + '%)'), textposition: 'outside'{'}'}]; const layout = [{'{'}title: 'Distribution Overview: ' + total + ' Total Records', xaxis: {'{'}title: 'Categories'{'}'}, yaxis: {'{'}title: 'Count'{'}'}, showlegend: true, height: 500, responsive: true, autosize: true{'}'}]; Plotly.newPlot('visualization-container', plotData, layout);",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"order": 1<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"}"},<br />
				&nbsp;&nbsp;&nbsp;&nbsp;{"{"}
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"id": "step-2",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"title": "Second Step Title",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "What this analysis reveals",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"insight": "Another important finding",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"visualizationType": "scatter",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"sqlQuery": "SELECT x_column, y_column FROM base WHERE condition LIMIT 1000",<br />
				&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"jsCode": "if (!data || Object.keys(data).length === 0) {'{'}console.error('No data'); return;{'}'} const correlation = calculateCorrelation(data.x_column, data.y_column); const plotData = [{'{'}type: 'scatter', x: data.x_column, y: data.y_column, mode: 'markers', name: 'Data Points (' + data.x_column.length + ' records)', marker: {'{'}size: 8, opacity: 0.6{'}'}{'}'}]; const layout = {'{'}title: 'Relationship Analysis (Correlation: ' + correlation.toFixed(3) + ')', xaxis: {'{'}title: 'X Values'{'}'}, yaxis: {'{'}title: 'Y Values'{'}'}, annotations: [{'{'}text: 'Sample: ' + data.x_column.length + ' records', x: 0.02, y: 0.98, xref: 'paper', yref: 'paper', showarrow: false{'}'}], height: 500, responsive: true, autosize: true{'}'}; function calculateCorrelation(x, y) {'{'}const n = x.length; const sumX = x.reduce((a, b) =&gt; a + b); const sumY = y.reduce((a, b) =&gt; a + b); const sumXY = x.reduce((sum, xi, i) =&gt; sum + xi * y[i], 0); const sumX2 = x.reduce((sum, xi) =&gt; sum + xi * xi, 0); const sumY2 = y.reduce((sum, yi) =&gt; sum + yi * yi, 0); return (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));{'}'} Plotly.newPlot('visualization-container', plotData, layout);",<br />
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
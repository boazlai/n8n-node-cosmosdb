import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, nodeNameToToolName } from 'n8n-workflow';

type ToolCall = {
	input: string;
};

export class ExampleToolNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Example Tool Node',
		name: 'exampleToolNode',
		group: ['transform'],
		version: 1,
		description: 'Example custom community node that exposes an AI tool',
		defaults: {
			name: 'Example Tool Node',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiTool],
		properties: [
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				typeOptions: { rows: 3 },
				default: 'Use this tool to process a plain-text request.',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
		const { DynamicStructuredTool } = require('@langchain/core/tools');
		const description = this.getNodeParameter('toolDescription', 0) as string;

		const tool = new DynamicStructuredTool({
			name: nodeNameToToolName(this.getNode()),
			description,
			schema: {
				type: 'object',
				properties: {
					input: {
						type: 'string',
						description: 'The text instruction for this tool',
					},
				},
				required: ['input'],
			},
			func: async (_payload: ToolCall) => {
				return 'Runtime execution happens through the node execution path.';
			},
		});

		return { response: tool };
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const query = String(items[0]?.json?.input ?? '').trim();

		if (!query) {
			return [[]];
		}

		if (query.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Tool input was empty');
		}

		return [[{ json: { output: { query, handled: true } } }]];
	}
}

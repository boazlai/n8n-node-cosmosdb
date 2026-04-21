import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

export class ExampleStandardNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Example Standard Node',
		name: 'exampleStandardNode',
		group: ['transform'],
		version: 1,
		description: 'Example custom community node with Main input and Main output',
		defaults: {
			name: 'Example Standard Node',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				default: 'hello world',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const message = this.getNodeParameter('message', 0) as string;
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			const item = items[itemIndex];
			if (!item) {
				throw new NodeOperationError(this.getNode(), 'Input item was not available', {
					itemIndex,
				});
			}

			returnData.push({
				json: {
					...item.json,
					message,
				},
			});
		}

		return [returnData];
	}
}

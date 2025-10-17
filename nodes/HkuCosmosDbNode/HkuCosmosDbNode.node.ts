import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { CosmosClient } from '@azure/cosmos';

export class HkuCosmosDbNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HKU Cosmos DB (Boaz)',
		name: 'hkuCosmosDb',
		icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
		group: ['transform'],
		version: 1,
		description: 'HKU Cosmos DB Node - Upsert documents to Azure Cosmos DB',
		defaults: {
			name: 'HKU Cosmos DB (Boaz)',
		},
		inputs: [
			'main',
			{
				displayName: 'Embedding',
				maxConnections: 1,
				type: 'ai_embedding',
				required: false,
			},
		],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'hkuCosmosDbApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Select',
						value: 'select',
						description: 'Query documents using SQL',
						action: 'Select documents',
					},
					{
						name: 'Upsert',
						value: 'upsert',
						description: 'Create or update a document',
						action: 'Upsert a document',
					},
				],
				default: 'select',
				description: 'The operation to perform',
			},
			{
				displayName: 'Database Name',
				name: 'databaseName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				required: true,
				description: 'The name of the Cosmos DB database',
			},
			{
				displayName: 'Container Name',
				name: 'containerName',
				type: 'options',
				typeOptions: {
					loadOptionsDependsOn: ['databaseName'],
					loadOptionsMethod: 'getContainers',
				},
				default: '',
				required: true,
				description: 'The name of the container within the database',
			},
			{
				displayName: 'SQL Query',
				name: 'sqlQuery',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: 'SELECT * FROM c ',
				required: true,
				placeholder: 'SELECT * FROM c WHERE c.status = "active"',
				description: 'The SQL query to execute against the container',
				displayOptions: {
					show: {
						operation: ['select'],
					},
				},
			},
			{
				displayName: 'Exclude Fields',
				name: 'excludeFields',
				type: 'boolean',
				default: false,
				description: 'Whether to exclude specific fields from the results',
				displayOptions: {
					show: {
						operation: ['select'],
					},
				},
			},
			{
				displayName: 'Fields to Exclude',
				name: 'fieldsToExclude',
				type: 'string',
				default: '',
				placeholder: 'field1,field2,field3',
				description: 'Comma-separated list of field names to exclude from results',
				displayOptions: {
					show: {
						operation: ['select'],
						excludeFields: [true],
					},
				},
			},
			{
				displayName: 'Item Content',
				name: 'itemContent',
				type: 'json',
				default: '{\n\t"id": "my-document-id",\n\t"category": ""\n}',
				required: true,
				typeOptions: {
					rows: 8,
				},
				description:
					'The JSON document to upsert. Must include an "id" field and the partition key field defined in your container.',
				displayOptions: {
					show: {
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'Add Embedding',
				name: 'addEmbedding',
				type: 'boolean',
				default: false,
				description: 'Whether to generate and add an embedding vector to the document',
				displayOptions: {
					show: {
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'Vector Field Name',
				name: 'vectorFieldName',
				type: 'string',
				default: 'vector',
				required: true,
				placeholder: 'vector',
				description: 'The field name where the embedding vector will be stored',
				displayOptions: {
					show: {
						operation: ['upsert'],
						addEmbedding: [true],
					},
				},
			},
			{
				displayName: 'Text to Embed',
				name: 'textToEmbed',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'text',
				description:
					'The text content to generate embedding for. You can use expressions to reference document fields.',
				displayOptions: {
					show: {
						operation: ['upsert'],
						addEmbedding: [true],
					},
				},
			},
			{
				displayName: 'Add Metadata',
				name: 'addMetadata',
				type: 'boolean',
				default: false,
				description:
					'Whether to add metadata key/value pairs that will be merged into document.metadata',
				displayOptions: {
					show: {
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				placeholder: 'Add Metadata',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				displayOptions: {
					show: {
						operation: ['upsert'],
						addMetadata: [true],
					},
				},
				options: [
					{
						name: 'pairs',
						displayName: 'Pairs',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								placeholder: 'myKey',
								description: 'The metadata key name',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'myValue',
								description: 'The metadata value',
							},
						],
					},
				],
				description: 'Key-value pairs to add to the document metadata field',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('hkuCosmosDbApi');
		const endpoint = credentials.endpoint as string;
		const key = credentials.key as string;

		const client = new CosmosClient({ endpoint, key });

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const databaseName = this.getNodeParameter('databaseName', itemIndex) as string;
				const containerName = this.getNodeParameter('containerName', itemIndex) as string;

				const database = client.database(databaseName);
				const container = database.container(containerName);

				if (operation === 'select') {
					// SELECT operation
					const sqlQuery = this.getNodeParameter('sqlQuery', itemIndex) as string;
					const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
					const fieldsToExclude = excludeFields
						? (this.getNodeParameter('fieldsToExclude', itemIndex, '') as string)
						: '';

					// Execute the SQL query
					const { resources } = await container.items.query(sqlQuery).fetchAll();

					// Process each result
					for (const resource of resources) {
						let processedResource = resource;

						// Remove excluded fields if requested
						if (excludeFields && fieldsToExclude) {
							const fieldsArray = fieldsToExclude
								.split(',')
								.map((f) => f.trim())
								.filter((f) => f.length > 0);

							processedResource = { ...resource };
							for (const field of fieldsArray) {
								delete processedResource[field];
							}
						}

						returnData.push({
							json: processedResource,
							pairedItem: itemIndex,
						});
					}
				} else if (operation === 'upsert') {
					const documentJson = this.getNodeParameter('itemContent', itemIndex) as string;

					let document: any;
					try {
						document = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson;
					} catch (error) {
						throw new NodeOperationError(this.getNode(), 'Invalid JSON in Document field', {
							itemIndex,
						});
					}

					// Handle embedding if enabled
					const addEmbedding = this.getNodeParameter('addEmbedding', itemIndex, false) as boolean;
					if (addEmbedding) {
						const vectorFieldName = this.getNodeParameter('vectorFieldName', itemIndex) as string;
						const textToEmbed = this.getNodeParameter('textToEmbed', itemIndex) as string;

						// Get the AI Embedding from the connected node
						const aiData = (await this.getInputConnectionData('ai_embedding', 0)) as any;

						if (!aiData?.embedQuery) {
							throw new NodeOperationError(
								this.getNode(),
								'No embedding model connected. Please connect an Embeddings node to the AI input.',
								{ itemIndex },
							);
						}

						// Generate embedding for the text
						const embedding = await aiData.embedQuery(textToEmbed);

						// Add embedding to document
						document[vectorFieldName] = embedding;
					}

					// Merge metadata into document.metadata if requested
					const addMetadata = this.getNodeParameter('addMetadata', itemIndex, false) as boolean;
					if (addMetadata) {
						const metadataCollection = this.getNodeParameter('metadata', itemIndex, {}) as {
							pairs?: Array<{ key?: string; value?: any }>;
						};
						const pairs = metadataCollection.pairs || [];
						const metadataObj: Record<string, any> = {};
						for (const pair of pairs) {
							if (pair && pair.key) {
								metadataObj[pair.key] = pair.value;
							}
						}
						// Merge with existing metadata or create new metadata object
						document.metadata = { ...(document.metadata || {}), ...metadataObj };
					}

					if (!document.id) {
						throw new NodeOperationError(this.getNode(), 'Document must contain an "id" field', {
							itemIndex,
						});
					}
					// Get container properties to determine partition key path
					const containerDef = await container.read();
					const partitionKeyPath =
						containerDef.resource?.partitionKey?.paths?.[0]?.replace('/', '') || 'id';

					// Validate partition key field exists
					if (!Object.prototype.hasOwnProperty.call(document, partitionKeyPath)) {
						throw new NodeOperationError(
							this.getNode(),
							`Document must include the partition key field '${partitionKeyPath}'. Add this field to your document.`,
							{ itemIndex },
						);
					}

					// Upsert the document (create or replace)
					const { resource } = await container.items.upsert(document);

					returnData.push({
						json: resource || document,
						pairedItem: itemIndex,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: itemIndex,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [returnData];
	}

	methods = {
		loadOptions: {
			async getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('hkuCosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;

				const client = new CosmosClient({ endpoint, key });

				try {
					const { resources } = await client.databases.readAll().fetchAll();
					return resources.map((db: any) => ({
						name: db.id,
						value: db.id,
					}));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load databases: ${error.message}`,
					);
				}
			},

			async getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('hkuCosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;

				if (!databaseName) {
					return [];
				}

				const client = new CosmosClient({ endpoint, key });

				try {
					const database = client.database(databaseName);
					const { resources } = await database.containers.readAll().fetchAll();
					return resources.map((container: any) => ({
						name: container.id,
						value: container.id,
					}));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load containers: ${error.message}`,
					);
				}
			},
		},
	};
}

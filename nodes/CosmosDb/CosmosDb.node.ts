import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
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
			NodeConnectionTypes.Main,
			{
				displayName: 'Embedding',
				type: NodeConnectionTypes.AiEmbedding,
				required: false,
				maxConnections: 1,
			},
		],
		outputs: [NodeConnectionTypes.Main],
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
						description: 'Query and retrieve documents',
						action: 'Select documents',
					},
					{
						name: 'Create or Update',
						value: 'upsert',
						description:
							'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Upsert a document',
					},
					{
						name: 'Hybrid Search',
						value: 'hybridSearch',
						description: 'Perform hybrid search combining full-text and vector search',
						action: 'Hybrid search documents',
					},
				],
				default: 'select',
			},
			{
				displayName: 'Database Name or ID',
				name: 'databaseName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Container Name or ID',
				name: 'containerName',
				type: 'options',
				typeOptions: {
					loadOptionsDependsOn: ['databaseName'],
					loadOptionsMethod: 'getContainers',
				},
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: {
						operation: ['select'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				placeholder: '50',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['select'],
						returnAll: [false],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Simplify Output',
				name: 'simplifyOutput',
				type: 'boolean',
				default: true,
				description:
					'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
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
				description: 'Whether to exclude additional specific fields from the results',
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
				default: 'vector,text',
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
				description:
					'The JSON document to upsert. Must include an "ID" field and the partition key field defined in your container.',
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
				displayName: 'Add Text',
				name: 'addText',
				type: 'boolean',
				default: false,
				description: 'Whether to add a text field to the document',
				displayOptions: {
					show: {
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'Text Field Name',
				name: 'textFieldName',
				type: 'string',
				default: 'text',
				required: true,
				placeholder: 'text',
				description: 'The field name where the text content will be stored',
				displayOptions: {
					show: {
						operation: ['upsert'],
						addText: [true],
					},
				},
			},
			{
				displayName: 'Text Content',
				name: 'textContent',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Enter text content',
				description:
					'The text content to add to the document. You can use expressions to reference other fields.',
				displayOptions: {
					show: {
						operation: ['upsert'],
						addText: [true],
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
			// Hybrid Search parameters
			{
				displayName: 'Keyword (Full Text Search)',
				name: 'keyword',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Enter full-text search keywords',
				description: 'Keywords for full-text search',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Search Query (Vector Search)',
				name: 'searchQuery',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Enter semantic search query',
				description: 'Query text for vector embedding search (used in VectorDistance)',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Top K',
				name: 'topK',
				type: 'number',
				default: 10,
				required: true,
				placeholder: '10',
				typeOptions: {
					minValue: 1,
					maxValue: 1000,
				},
				description: 'Number of top results to retrieve from the database',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Partition Key Field',
				name: 'partitionKeyField',
				type: 'string',
				default: 'category',
				required: true,
				placeholder: 'category',
				description: 'The partition key field name (e.g., category, ID)',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Partition Key Value',
				name: 'partitionKeyValue',
				type: 'string',
				default: '',
				required: true,
				placeholder: '',
				description: 'The partition key value for filtering (optional - leave empty if not needed)',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Simplify Output',
				name: 'simplifyOutput',
				type: 'boolean',
				default: true,
				description:
					'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Exclude Fields',
				name: 'excludeFields',
				type: 'boolean',
				default: false,
				description: 'Whether to exclude additional specific fields from the results',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
					},
				},
			},
			{
				displayName: 'Fields to Exclude',
				name: 'fieldsToExclude',
				type: 'string',
				default: 'vector,text',
				placeholder: 'field1,field2,field3',
				description: 'Comma-separated list of field names to exclude from results',
				displayOptions: {
					show: {
						operation: ['hybridSearch'],
						excludeFields: [true],
					},
				},
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
					const returnAll = this.getNodeParameter('returnAll', itemIndex, true) as boolean;
					const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
					const simplifyOutput = this.getNodeParameter(
						'simplifyOutput',
						itemIndex,
						true,
					) as boolean;
					const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
					const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '') as string;

					// Execute the SQL query
					const { resources } = await container.items.query(sqlQuery).fetchAll();

					// Define internal Cosmos DB fields to exclude when simplifying
					const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];

					// Apply limit if not returning all
					const resultSet = returnAll ? resources : resources.slice(0, limit);

					// Process each result
					for (const resource of resultSet) {
						let processedResource = resource;

						// Remove internal fields if simplify is enabled
						if (simplifyOutput) {
							processedResource = { ...resource };
							for (const field of internalFields) {
								delete processedResource[field];
							}
						}

						// Remove additional excluded fields if requested
						if (excludeFields && fieldsToExclude) {
							const fieldsArray = fieldsToExclude
								.split(',')
								.map((f) => f.trim())
								.filter((f) => f.length > 0);

							processedResource = { ...processedResource };
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
						const aiData = (await this.getInputConnectionData(
							NodeConnectionTypes.AiEmbedding,
							0,
						)) as any;

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

					// Handle text if enabled
					const addText = this.getNodeParameter('addText', itemIndex, false) as boolean;
					if (addText) {
						const textFieldName = this.getNodeParameter('textFieldName', itemIndex) as string;
						const textContent = this.getNodeParameter('textContent', itemIndex) as string;

						// Add text to document
						document[textFieldName] = textContent;
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
				} else if (operation === 'hybridSearch') {
					// HYBRID SEARCH operation - RRF combining full-text and vector search
					const keyword = this.getNodeParameter('keyword', itemIndex) as string;
					const searchQuery = this.getNodeParameter('searchQuery', itemIndex) as string;
					const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
					const partitionKeyField = this.getNodeParameter(
						'partitionKeyField',
						itemIndex,
						'category',
					) as string;
					const partitionKeyValue = this.getNodeParameter(
						'partitionKeyValue',
						itemIndex,
						'',
					) as string;
					const simplifyOutput = this.getNodeParameter(
						'simplifyOutput',
						itemIndex,
						true,
					) as boolean;
					const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
					const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '') as string;

					// Generate embedding from search query using AI embedding
					const aiData = (await this.getInputConnectionData(
						NodeConnectionTypes.AiEmbedding,
						0,
					)) as {
						embedQuery: (query: string) => Promise<number[]>;
					};
					if (!aiData || typeof aiData.embedQuery !== 'function') {
						throw new NodeOperationError(
							this.getNode(),
							'AI Embedding is required for hybrid search. Please connect an embeddings node to the Embedding input.',
							{ itemIndex },
						);
					}

					// Generate embedding for the search query
					const embedding = await aiData.embedQuery(searchQuery);

					// RRF Hybrid Search (Full-text + Vector) - Direct Cosmos SDK
					// Escape inputs to avoid breaking SQL
					const escapeDoubleQuotes = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					const escapeSingleQuotes = (s: string) => s.replace(/'/g, "''");
					const safeKeyword = escapeDoubleQuotes(keyword)
						.trim()
						.split(/\s+/)
						.map((word) => `'${word}'`)
						.join(',');
					const safePartitionKeyValue = partitionKeyValue
						? escapeSingleQuotes(partitionKeyValue)
						: '';

					// Inline the embedding as a literal array in the SQL
					const embeddingLiteral = `[${embedding.join(',')}]`;

					// Build RRF hybrid search query with inlined values
					const rrfQuery = partitionKeyValue
						? `SELECT TOP ${topK} * FROM c WHERE c.${partitionKeyField}='${safePartitionKeyValue}' ORDER BY RANK RRF(FullTextScore(c.text, ${safeKeyword}), VectorDistance(c.vector, ${embeddingLiteral}))`
						: `SELECT TOP ${topK} * FROM c ORDER BY RANK RRF(FullTextScore(c.text, ${safeKeyword}), VectorDistance(c.vector, ${embeddingLiteral}))`;


					try {
						// Execute RRF query directly through Cosmos SDK
						const { resources } = await container.items.query(rrfQuery).fetchAll();

						// Define internal Cosmos DB fields to exclude when simplifying
						const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];

						if (resources && resources.length > 0) {
							// Process each result
							for (const resource of resources) {
								let processedResource = resource;

								// Remove internal fields if simplify is enabled
								if (simplifyOutput) {
									processedResource = { ...resource };
									for (const field of internalFields) {
										delete processedResource[field];
									}
								}

								// Remove additional excluded fields if requested
								if (excludeFields && fieldsToExclude) {
									const fieldsArray = fieldsToExclude
										.split(',')
										.map((f) => f.trim())
										.filter((f) => f.length > 0);

									processedResource = { ...processedResource };
									for (const field of fieldsArray) {
										delete processedResource[field];
									}
								}

								returnData.push({
									json: processedResource,
									pairedItem: itemIndex,
								});
							}
						} else {
							returnData.push({
								json: {
									message: 'No results found',
									keyword,
									searchQuery,
									topK,
									resultsCount: 0,
								},
								pairedItem: itemIndex,
							});
						}
					} catch (error) {
						console.error('RRF Hybrid Search Error:', error);
						throw new NodeOperationError(
							this.getNode(),
							`RRF hybrid search failed: ${error.message}`,
							{ itemIndex },
						);
					}
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
